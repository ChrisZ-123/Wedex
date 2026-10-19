import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import {AppStore,STATE,safeError,publicError} from './store.js';
import {WechatClient,API_BASE,trustedUrl,normalizeMessage} from './wechat.js';
import {CodexRuntime,validateSettings} from './codex.js';
import {ChatFeatures} from './chat-features.js';
import {NativeImages,readGeneratedImage} from './native-images.js';
import {CHAT_SCHEMA,CHAT_GUIDANCE,parseChatOutput} from './chat-protocol.js';
import {takeQueuedBatch} from './queue.js';

export function splitText(text,limit=4000){
  const result=[];for(let i=0;i<text.length;){let end=Math.min(i+limit,text.length);if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1]))end--;result.push(text.slice(i,end));i=end;}return result;
}
export class Assistant {
  constructor({vault,store=new AppStore(),client,runtime,features,images}={}){
    this.vault=vault;this.store=store;this.wechat={state:vault.data.wechat?'connected':'unbound',error:null,login:null};
    this.client=client??new WechatClient({connection:()=>this.vault.data.wechat});
    this.codex=runtime??new CodexRuntime({onChange:()=>this.accountChanged(),onProgress:status=>{if(this.running){this.running.status=status;this.store.save();}}});
    const binding=vault.data.wechat;
    if(binding){
      if(this.store.data.owner&&this.store.data.owner.userId!==binding.userId)throw publicError('微信凭据与会话主人不一致，未启动接入');
      if(!this.store.data.owner||this.store.data.owner.botId!==binding.botId){this.store.data.owner={botId:binding.botId,userId:binding.userId};this.store.data.cursor='';this.invalidateGate();this.store.save();}
    }
    this.features=features??new ChatFeatures({store:this.store,vault});
    this.images=images??new NativeImages();
    this.store.data.chatReady??=Boolean(this.store.data.gate.confirmed);this.store.data.settings.imageMode??='requested';this.store.save();
    this.closing=false;this.qrController=null;this.loginPending=false;
    this.pollController=null;this.running=null;this.pumping=false;
  }
  accountChanged(){
    if(this.codex?.state.state!=='ready'||!this.features||typeof this.pumping!=='boolean'||!Object.hasOwn(this,'running'))return;
    const settings=this.store.data.settings;
    if(!settings.model){
      const model=this.codex.state.models.find(m=>m.isDefault);
      if(!model){this.codex.state.error='账号目录未给出默认模型，请手动选择';return;}
      Object.assign(settings,{model:model.model,reasoningEffort:model.defaultReasoningEffort,serviceTier:model.defaultServiceTier??null});this.store.save();
    }
    return this.pump().catch(error=>{this.codex.state.error=safeError(error);});
  }
  invalidateGate(){this.store.data.gateEpoch++;this.store.data.gate={confirmed:false,checks:{}};this.store.data.mediaEvidence={imageReceive:0,imageSend:0};}
  start(){if(this.vault.data.wechat)this.startPolling();}
  status(){
    const data=this.store.data;
    const login=this.wechat.login?{state:this.wechat.login.state,qrDataUrl:this.wechat.login.qrDataUrl,note:this.wechat.login.note}:null;
    return {stage:data.chatReady?'chat':'acceptance',capabilities:{memory:Boolean(data.chatReady),stickers:Boolean(data.chatReady),nativeImages:Boolean(data.chatReady),backup:Boolean(data.chatReady)},images:this.images.status(),gate:data.gate,wechat:{state:this.wechat.state,error:this.wechat.error,login},codex:this.codex.state,
      settings:data.settings,chat:{paused:data.paused,running:this.running?{id:this.running.id,status:this.running.status}:null,pending:data.history.filter(m=>m.status==='queued').length},
      history:data.history.slice(-100),runs:data.runs.slice(-40),mediaEvidence:data.mediaEvidence};
  }
  async loginWechat(){
    if(this.closing)throw publicError('助手正在停止');
    if(this.loginPending)throw publicError('已有扫码请求正在准备');
    this.loginPending=true;
    try{
    if(this.running)throw publicError('请先停止当前回复再绑定微信');
    if(this.wechat.login&&['wait','scaned','need_verifycode'].includes(this.wechat.login.state))throw publicError('已有微信扫码请求，请完成当前请求或等待过期');
    this.qrController?.abort();this.qrController=new AbortController();
    const response=await this.client.qr({signal:this.qrController.signal});
    if(this.closing)throw publicError('助手已停止，未继续扫码');
    if(typeof response.qrcode!=='string'||typeof response.qrcode_img_content!=='string')throw publicError('微信未返回有效二维码');
    const login={controller:this.qrController,state:'wait',qrcode:response.qrcode,baseUrl:API_BASE,qrDataUrl:await QRCode.toDataURL(response.qrcode_img_content,{width:280,margin:2}),started:Date.now(),code:null,note:'请使用你日常聊天的微信扫码，确认连接'};
    this.wechat.login=login;this.wechat.state='waiting_scan';this.wechat.error=null;
    void this.pollQr(login);return {started:true};
    }finally{this.loginPending=false;}
  }
  verifyCode(code){
    if(this.wechat.login?.state!=='need_verifycode')throw publicError('当前不需要验证码');
    if(typeof code!=='string'||!/^\d{4,12}$/.test(code))throw publicError('请输入手机显示的数字验证码');
    this.wechat.login.code=code;this.wechat.login.state='wait';this.wechat.login.note='正在提交手机验证码';
  }
  async pollQr(login){
    let failures=0;
    while(!this.closing&&this.wechat.login===login&&Date.now()-login.started<8*60*1000){
      if(login.state==='need_verifycode'){await new Promise(r=>setTimeout(r,1000));continue;}
      try{
        const code=login.code;login.code=null;
        const result=await this.client.qrStatus(login.qrcode,{base:login.baseUrl,code,signal:login.controller?.signal});
        if(this.closing||this.wechat.login!==login)return;
        failures=0;login.state=result.status;
        if(result.status==='scaned_but_redirect'){
          login.baseUrl=trustedUrl(`https://${result.redirect_host}`).origin;login.state='wait';
        }else if(result.status==='need_verifycode'){
          this.wechat.state='need_verifycode';login.note='请在此输入手机显示的验证码';
        }else if(result.status==='confirmed'){
          if(!result.bot_token||!result.ilink_bot_id||!result.ilink_user_id)throw publicError('微信登录信息不完整，未保存凭据');
          const baseUrl=trustedUrl(result.baseurl??login.baseUrl).origin;
          const previous=this.store.data.owner;
          if(previous&&previous.userId!==result.ilink_user_id)throw publicError('扫码账号与已有助手主人不同，请使用原微信账号；未混用会话');
          this.pollController?.abort();
          const changed=previous?.botId!==result.ilink_bot_id;
          this.vault.data.wechat={botToken:result.bot_token,botId:result.ilink_bot_id,userId:result.ilink_user_id,baseUrl};
          if(changed)this.vault.data.contextTokens={};
          await this.vault.save();
          this.store.data.owner={botId:result.ilink_bot_id,userId:result.ilink_user_id};
          if(changed){this.store.data.cursor='';this.invalidateGate();}
          this.store.save();login.qrDataUrl=null;login.qrcode=null;login.note='已绑定扫码用户，仅此用户可聊天';
          this.wechat.state='connected';this.startPolling();return;
        }else if(result.status==='binded_redirect'&&this.vault.data.wechat&&this.store.data.owner?.userId===this.vault.data.wechat.userId&&this.store.data.owner?.botId===this.vault.data.wechat.botId){
          login.state='confirmed';login.qrDataUrl=null;login.qrcode=null;login.note='已使用本部署保存的官方绑定凭据继续连接';this.wechat.state='connected';this.startPolling();return;
        }else if(['expired','verify_code_blocked','binded_redirect'].includes(result.status)){
          login.qrDataUrl=null;login.qrcode=null;this.wechat.state='expired';
          login.note=result.status==='binded_redirect'?'该连接已绑定，但本部署没有有效凭据，请在微信确认绑定状态后重新扫码':'二维码或验证已失效，请重新发起扫码';return;
        }else if(result.status==='scaned'){login.note='已扫码，请在微信确认连接';}
        await new Promise(r=>setTimeout(r,1000));
      }catch(error){
        if(this.closing||this.wechat.login!==login)return;
        if(error.code==='NETWORK'||error.httpStatus>=500){
          login.state='wait';this.wechat.state='waiting_scan';login.note='扫码查询连接暂时中断，将继续只读查询；验证码不会自动重新提交';
          await new Promise(r=>setTimeout(r,Math.min(++failures*1000,5000)));continue;
        }
        login.qrDataUrl=null;login.qrcode=null;login.state='error';this.wechat.state='error';this.wechat.error=safeError(error);return;
      }
    }
    if(this.wechat.login===login){login.state='expired';login.qrDataUrl=null;login.qrcode=null;this.wechat.state='expired';login.note='扫码超时，请重新发起';}
  }
  startPolling(){
    if(this.closing)return;
    this.pollController?.abort();const controller=new AbortController();this.pollController=controller;
    void this.poll(controller);
  }
  async poll(controller){
    let failures=0,timeout=35000;
    try{await this.client.lifecycle(true);}catch{this.wechat.error='微信启动通知未确认；正在检查收取连接';}
    while(!controller.signal.aborted){
      try{
        const response=await this.client.updates(this.store.data.cursor,controller.signal,timeout);
        if(controller.signal.aborted)return;
        timeout=response.longpolling_timeout_ms??35000;
        await this.receiveBatch(response);
        failures=0;this.wechat.state='connected';this.wechat.error=null;
        void this.pump();
        if(!response.msgs?.length)await new Promise(r=>setTimeout(r,500));
      }catch(error){
        if(controller.signal.aborted)return;
        if(error.code==='AUTH_EXPIRED'||error.httpStatus===401||error.httpStatus===403){this.wechat.state='expired';this.wechat.error='微信连接已失效，需要重新扫码';return;}
        if(!['NETWORK','HTTP','API'].includes(error.code)){this.wechat.state='error';this.wechat.error=safeError(error);return;}
        const delay=[1000,2000,5000,10000,30000][Math.min(failures++,4)];
        this.wechat.state='reconnecting';this.wechat.error=`收取连接中断，${delay/1000} 秒后重新连接；不会重跑模型或重发回复`;
        await new Promise(resolve=>{const timer=setTimeout(done,delay);function done(){clearTimeout(timer);controller.signal.removeEventListener('abort',done);resolve();}controller.signal.addEventListener('abort',done,{once:true});});
      }
    }
  }
  async receiveBatch(response){
    const owner=this.store.data.owner;if(!owner)throw publicError('未建立主人身份，已停止收取');
    if(response.msgs!==undefined&&!Array.isArray(response.msgs))throw publicError('微信消息响应结构无效');
    const existing=new Set(this.store.data.history.filter(m=>m.sourceId).map(m=>m.sourceId));
    const pending=[];let secretsChanged=false;
    for(const raw of response.msgs??[]){
      const message=normalizeMessage(raw,owner.botId,owner.userId);if(!message||existing.has(message.sourceId))continue;
      existing.add(message.sourceId);
      if(message.contextToken){this.vault.data.contextTokens??={};this.vault.data.contextTokens[owner.userId]=message.contextToken;secretsChanged=true;}
      const images=message.images.map(item=>{
        const id=crypto.randomUUID();this.vault.data.inboundMedia??={};this.vault.data.inboundMedia[id]={item,sourceId:message.sourceId,userId:owner.userId};secretsChanged=true;return {id,status:'pending',gateEpoch:this.store.data.gateEpoch};
      });
      let text=this.vault.redact(message.text);
      const references=message.references.map(ref=>({...('text' in ref?{text:this.vault.redact(ref.text)}:{}),...('messageId' in ref?{messageId:ref.messageId}:{})}));
      // Restore only structured WeChat quotes, scoped to this bot's real message IDs.
      const quotes=references.map(ref=>{
        if(ref.text!==undefined)return '[引用材料] '+this.vault.redact(ref.text);
        const id=ref.messageId;
        const original=[...this.store.data.history,...pending].find(m=>m.kind==='user'&&m.sourceId===owner.botId+'/'+id);
        if(original)return '[引用材料] '+original.text;
        for(const run of this.store.data.runs){
          if(!run.sourceMessageIds?.some(source=>source.startsWith(owner.botId+'/')))continue;
          const segment=run.delivery?.find(d=>d.acknowledged===true&&d.messageId===id&&typeof d.text==='string');
          if(segment)return '[引用材料] '+segment.text;
        }
        return `[引用消息 ID: ${id}] [本地没有原文，不能猜测]`;
      });
      text=[text,...quotes].filter(Boolean).join('\n');
      pending.push({id:crypto.randomUUID(),kind:'user',sourceId:message.sourceId,messageId:message.messageId,text,images,references,time:new Date().toISOString(),status:this.store.data.paused?'paused':'queued'});
    }
    // Persist encrypted media/context tokens first; then journal messages and cursor together.
    if(secretsChanged)await this.vault.save();
    const previous=this.store.data;
    this.store.data={...previous,history:[...previous.history,...pending],cursor:response.get_updates_buf||previous.cursor};
    try{this.store.save();}catch(error){this.store.data=previous;throw error;}
  }
  current(generation,owner){return !this.closing&&!this.store.data.paused&&this.store.data.generation===generation&&this.store.data.owner?.userId===owner.userId&&this.store.data.owner?.botId===owner.botId&&this.wechat.state==='connected';}
  async loadImage(id){
    if(!/^[\da-f-]{36}$/i.test(id))throw publicError('图片标识无效');
    const reference=this.vault.data.inboundMedia?.[id];
    if(!reference||reference.userId!==this.store.data.owner?.userId)throw publicError('图片不属于当前主人');
    const record=this.store.data.history.flatMap(m=>m.images??[]).find(m=>m.id===id);
    if(!record)throw publicError('图片记录不存在');
    const file=path.join(STATE,'media',id);
    if(fs.existsSync(file)){const bytes=fs.readFileSync(file);return {bytes,mime:record.mime};}
    try{
      const image=await this.client.downloadImage(reference.item);
      fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,image.bytes);
      record.status='downloaded';record.mime=image.mime;if(record.gateEpoch===this.store.data.gateEpoch)this.store.data.mediaEvidence.imageReceive++;this.store.save();return image;
    }catch(error){record.status='error';record.error=safeError(error);this.store.save();throw error;}
  }
  async pump(){
    if(this.closing||this.pumping||this.running||this.store.data.paused||this.codex.state.state!=='ready')return;
    this.pumping=true;
    try{
      while(!this.closing&&!this.store.data.paused&&this.codex.state.state==='ready'){
        const batch=takeQueuedBatch(this.store.data.history);if(!batch.length)break;
        const owner={...this.store.data.owner},generation=this.store.data.generation,settings=structuredClone(this.store.data.settings);
        const run={id:crypto.randomUUID(),gateEpoch:this.store.data.gateEpoch,status:'preparing',model:settings.model,reasoningEffort:settings.reasoningEffort,serviceTier:settings.serviceTier,startedAt:new Date().toISOString(),sourceMessageIds:batch.map(m=>m.sourceId),queueMs:Date.now()-Date.parse(batch[0].time),modelMs:0,imageMs:0,sendMs:0,phoneConfirmed:null,delivery:[]};
        for(const message of batch)message.status='processing';this.running=run;this.store.data.runs.push(run);this.store.save();
        try{
          validateSettings(settings,this.codex.state.models);
          const full=this.store.data.chatReady;
          const context=full?this.features.context(batch.map(m=>m.text).join('\n'),{sourceMessages:batch}):null;
          const input=[{type:'text',text:JSON.stringify({messages:batch.map(m=>({id:m.messageId,sourceMessageId:m.sourceId,text:m.text,images:m.images?.length??0,references:m.references??[]}))}),text_elements:[]}];
          for(const message of batch)for(const image of message.images??[]){
            try{const media=await this.loadImage(image.id);input.push({type:'text',text:JSON.stringify({sourceImage:{messageId:message.messageId,imageId:image.id}}),text_elements:[]},{type:'image',url:`data:${media.mime};base64,${media.bytes.toString('base64')}`});}
            catch(error){input.push({type:'text',text:`消息 ${message.messageId} 的图片读取失败：${safeError(error)}，不能猜测图片内容。`,text_elements:[]});}
          }
          if(!this.current(generation,owner))throw publicError('本轮已暂停或停止，未继续处理');
          if(full)for(const learning of context.learningIds){const sticker=this.features.loadSticker(learning.id);input.push({type:'text',text:JSON.stringify({catalogImage:learning}),text_elements:[]},{type:'image',url:`data:${sticker.mime};base64,${sticker.bytes.toString('base64')}`});}
          const contextToken=this.vault.data.contextTokens?.[owner.userId];
          if(!contextToken)throw publicError('微信缺少当前会话令牌，未提交模型');
          void this.client.typing(owner.userId,contextToken,1,{isCurrent:()=>this.running?.id===run.id&&this.current(generation,owner)}).catch(()=>{});
          run.status='thinking';const modelStart=Date.now();this.store.save();
          const inboundSources=this.store.data.history.filter(m=>m.kind==='user'&&m.sourceId===owner.botId+'/'+m.messageId&&m.images?.some(i=>i.status==='downloaded')).map(m=>({...m,kind:'user'}));
          const generatedSources=this.store.data.runs.filter(r=>r.sourceMessageIds?.length&&r.sourceMessageIds.every(id=>id.startsWith(owner.botId+'/'))).flatMap(r=>
            (r.delivery??[]).filter(d=>d.kind==='generated_image'&&d.acknowledged===true&&typeof d.messageId==='string'&&d.messageId&&r.generatedImages?.length===1).map(d=>({kind:'generated',messageId:d.messageId,sourceId:owner.botId+'/'+d.messageId,time:r.finishedAt??r.startedAt,runId:r.id,images:r.generatedImages.map(image=>({...image,status:'generated'}))})));
          const allSources=[...inboundSources,...generatedSources].sort((a,b)=>String(b.time??'').localeCompare(String(a.time??'')));
          const currentSourceIds=new Set(batch.map(m=>m.sourceId));
          const quotedSourceIds=new Set(batch.flatMap(m=>(m.references??[]).filter(r=>typeof r.messageId==='string').map(r=>owner.botId+'/'+r.messageId)));
          const seenSources=new Set();
          const imageMessages=[...allSources.filter(m=>currentSourceIds.has(m.sourceId)),...allSources.filter(m=>quotedSourceIds.has(m.sourceId)),...allSources.slice(0,20)].filter(m=>{if(seenSources.has(m.sourceId))return false;seenSources.add(m.sourceId);return true;}).slice(0,10);
          const imageSources=imageMessages.map(m=>({kind:m.kind,messageId:m.messageId,sourceMessageId:m.sourceId,time:m.time,...(m.runId?{runId:m.runId}:{}),imageIds:m.images.filter(i=>i.status==='downloaded'||i.status==='generated').map(i=>i.id)}));
          const result=await this.codex.run(this.store.data.threadId,input,settings,{isCurrent:()=>this.current(generation,owner),onThread:id=>{this.store.data.threadId=id;this.store.save();},...(full?{outputSchema:CHAT_SCHEMA,context:{persona:context.persona??settings.persona,longTermMemory:context.memory,expression:{feedback:context.feedbackHint,stickers:context.stickers,learningIds:context.learningIds,imageMode:settings.imageMode},recentSourceMessages:batch.map(m=>({sourceMessageId:m.sourceId,text:m.text})),imageSources,memoryProtocol:CHAT_GUIDANCE}}:{})});
          run.modelMs=Date.now()-modelStart;
          const output=full?parseChatOutput(result.text):{reply:result.text,stickerIds:[],imagePrompt:'',imageSourceMessageId:null,imageSourceImageId:null};
          run.reply=this.vault.redact(output.reply);
          if(!this.current(generation,owner))throw publicError('本轮已暂停或停止，未应用模型结果');
          if(full){run.learning=this.features.applyModel(output,{sourceMessages:batch,memoryContext:context.memory,learningIds:context.learningIds});}
          if(!run.reply.trim()&&!output.stickerIds.length&&!output.imagePrompt)throw publicError('模型没有生成可发送内容');
          if(!this.current(generation,owner))throw publicError('回复完成前已暂停或重置，未继续发送');
          run.status='sending';this.store.save();
          const sendTimed=async operation=>{const started=Date.now();try{return await operation();}finally{run.sendMs+=Date.now()-started;this.store.save();}};
          for(const part of splitText(run.reply)){
            if(!this.current(generation,owner))throw publicError('发送途中已停止；此前提交微信的消息无法撤回');
            const delivery=await sendTimed(()=>this.client.sendText(owner.userId,part,this.vault.data.contextTokens[owner.userId],{runId:run.id,isCurrent:()=>this.current(generation,owner)}));
            run.delivery.push({...delivery,text:part});this.store.save();
          }
          for(const stickerId of output.stickerIds){
            if(!context?.stickers.some(s=>s.id===stickerId))throw publicError('模型选择了不在当前目录的表情，未发送');
            const sticker=this.features.loadSticker(stickerId);
            const delivery=await sendTimed(()=>this.client.sendImage(owner.userId,sticker.bytes,this.vault.data.contextTokens[owner.userId],{runId:run.id,isCurrent:()=>this.current(generation,owner)}));
            run.delivery.push({...delivery,kind:'sticker',stickerId});this.store.save();
          }
          if(output.imagePrompt){
            if(settings.imageMode==='off')throw publicError('当前已关闭图片创作，未执行生图');
            const sourceImages=[];
            if(output.imageSourceMessageId!==null){
              const source=imageMessages.find(m=>m.messageId===output.imageSourceMessageId);
              const candidates=source?.images?.filter(i=>i.status==='downloaded'||(source.kind==='generated'&&i.status==='generated'))??[];
              if(output.imageSourceImageId===null&&candidates.length>1)throw publicError('这条消息有多张参考图，请提供单张图片或明确指定要编辑的图片，未默认使用第一张');
              const reference=output.imageSourceImageId===null?(candidates.length===1?candidates[0]:null):candidates.find(i=>i.id===output.imageSourceImageId);
              if(!reference)throw publicError('编辑参考图不在所选消息的当前主人真实图片来源中，未使用其他图片替代');
              let media;
              if(source.kind==='generated'){media=readGeneratedImage(reference,this.images.outputDir??path.join(STATE,'generated'));}
              else{const provenance=this.vault.data.inboundMedia?.[reference.id];if(!provenance||provenance.userId!==owner.userId||provenance.sourceId!==source.sourceId)throw publicError('编辑参考图不在所选消息的当前主人真实图片来源中，未使用其他图片替代');media=await this.loadImage(reference.id);}
              sourceImages.push({url:`data:${media.mime};base64,${media.bytes.toString('base64')}`});
            }
            run.status='image_starting';this.store.save();let generated;const imageStart=Date.now();
            try{generated=await this.images.generate({prompt:output.imagePrompt,sourceImages,settings,isCurrent:()=>this.current(generation,owner),onStatus:status=>{if(this.running?.id===run.id){run.status='image_'+status;this.store.save();}}});}
            finally{run.imageMs+=Date.now()-imageStart;this.store.save();}
            if(!this.current(generation,owner))throw publicError('图片生成完成前已停止，未发送');
            run.generatedImages=[{id:path.basename(generated.path),mime:generated.mime}];run.status='sending_image';this.store.save();
            const delivery=await sendTimed(()=>this.client.sendImage(owner.userId,generated.bytes,this.vault.data.contextTokens[owner.userId],{runId:run.id,isCurrent:()=>this.current(generation,owner)}));
            run.delivery.push({...delivery,kind:'generated_image'});this.store.save();
          }
          run.status='completed';
          this.store.append({kind:'assistant',text:run.reply,runId:run.id,status:'api_acknowledged',delivery:run.delivery.map(d=>({clientId:d.clientId,messageId:d.messageId,acknowledged:d.acknowledged,kind:d.kind,stickerId:d.stickerId})),generatedImages:run.generatedImages??[]});
        }catch(error){
          const failedDuringDelivery=run.status==='sending'||run.status==='sending_image';
          run.status=this.store.data.generation!==generation||this.store.data.paused?'interrupted':'failed';run.error=safeError(error);
          if(run.status==='failed'&&failedDuringDelivery&&['NETWORK','HTTP'].includes(error.code))run.deliveryUnknown=true;
        }finally{
          for(const message of batch)message.status=run.status==='completed'?'processed':run.status;
          run.finishedAt=new Date().toISOString();this.running=null;this.store.save();
          const context=this.vault.data.contextTokens?.[owner.userId];if(context)void this.client.typing(owner.userId,context,2,{isCurrent:()=>!this.running&&this.store.data.owner?.userId===owner.userId&&this.store.data.owner?.botId===owner.botId}).catch(()=>{});
        }
      }
    }finally{this.pumping=false;}
  }
  async pause(paused){
    if(typeof paused!=='boolean')throw publicError('暂停设置无效');
    this.store.data.paused=paused;
    if(paused){this.store.data.generation++;for(const message of this.store.data.history)if(message.status==='queued')message.status='paused';}
    this.store.save();if(paused)await Promise.all([this.codex.interrupt(),this.images.cancel()]);
  }
  async stop(){this.store.data.generation++;this.store.save();await Promise.all([this.codex.interrupt(),this.images.cancel()]);}
  async reset(){this.store.data.generation++;this.store.data.threadId=null;this.invalidateGate();for(const message of this.store.data.history)if(message.status==='queued')message.status='reset';this.store.save();await Promise.all([this.codex.interrupt(),this.images.cancel()]);}
  saveSettings(next){validateSettings(next,this.codex.state.models);if(['model','reasoningEffort','serviceTier','persona'].some(key=>next[key]!==this.store.data.settings[key]))this.invalidateGate();this.store.data.settings={model:next.model,reasoningEffort:next.reasoningEffort,serviceTier:next.serviceTier,persona:next.persona,imageMode:next.imageMode??this.store.data.settings.imageMode??'requested'};this.store.save();}
  confirmRun({runId,received,note=''}){
    const run=this.store.data.runs.find(r=>r.id===runId);
    if(!run||run.status!=='completed'||typeof received!=='boolean'||typeof note!=='string'||note.length>1000)throw publicError('验收记录无效，必须选择已完成的真实回复');
    run.phoneConfirmed=received;run.phoneNote=this.vault.redact(note);
    if(!received)this.store.data.gate={confirmed:false,checks:{},reason:'用户确认有消息未完整送达，需要先核实通道'};
    this.store.save();
  }
  confirmGate({confirmed,checks}){
    const required=['persona','continuous','imageReceive','imageSend'];
    if(confirmed!==true||!required.every(key=>checks?.[key]===true))throw publicError('请逐项完成手机端验收');
    if(this.store.data.runs.filter(r=>r.status==='completed'&&r.phoneConfirmed===true&&!r.kind&&r.gateEpoch===this.store.data.gateEpoch).length<3)throw publicError('至少需要 3 轮真实文字回复，并逐轮确认手机完整收到');
    if(this.store.data.runs.some(r=>r.phoneConfirmed===false&&r.gateEpoch===this.store.data.gateEpoch))throw publicError('存在未完整送达的记录，需要先核实，不能直接标记通过');
    if(!this.store.data.mediaEvidence.imageReceive||!this.store.data.mediaEvidence.imageSend)throw publicError('图片两个方向尚未完成接口测试');
    this.store.data.gate={confirmed:true,checks:{...checks},confirmedAt:new Date().toISOString()};this.store.data.chatReady=true;this.store.save();
  }
  async echoImage(imageId){
    if(this.closing||this.running||this.pumping||this.store.data.paused||this.wechat.state!=='connected')throw publicError('请在连接正常、没有当前回复且未暂停时回传图片');
    const owner={...this.store.data.owner},generation=this.store.data.generation;
    const run={id:crypto.randomUUID(),gateEpoch:this.store.data.gateEpoch,kind:'image_echo',status:'preparing',phoneConfirmed:null,delivery:[],startedAt:new Date().toISOString(),reply:'[回传主人提供的图片，验证媒体通道]'};
    this.running=run;this.store.data.runs.push(run);this.store.save();
    try{
      const media=await this.loadImage(imageId);
      if(!this.current(generation,owner))throw publicError('图片发送前已停止');
      run.status='sending';this.store.save();const started=Date.now();
      const delivery=await this.client.sendImage(owner.userId,media.bytes,this.vault.data.contextTokens?.[owner.userId],{runId:run.id,isCurrent:()=>this.current(generation,owner)});
      run.delivery.push(delivery);run.sendMs=Date.now()-started;run.status='completed';if(run.gateEpoch===this.store.data.gateEpoch)this.store.data.mediaEvidence.imageSend++;
      this.store.append({kind:'assistant',text:run.reply,runId:run.id,status:'api_acknowledged',images:[{id:imageId,status:'sent'}]});
    }catch(error){run.status='failed';run.error=safeError(error);throw error;}
    finally{run.finishedAt=new Date().toISOString();this.running=null;this.store.save();void this.pump();}
    return {acknowledged:true,runId:run.id};
  }
  roleChange(input){const before=this.features.context('',{}).persona;const result=this.features.role(input);if(before!==this.features.context('',{}).persona){this.invalidateGate();this.store.save();}return result;}
  async restoreBackup(id){
    if(this.running||this.pumping||this.images.status().inFlight||!this.store.data.paused)throw publicError('请先暂停并等待全部回复和图片任务结束，再恢复备份');
    const preview=this.features.previews.get(id);if(!preview)throw publicError('恢复预览已失效');
    validateSettings(preview.data.sections.settings,this.codex.state.models);
    return this.features.restoreBackup(id,{prepareNext:next=>{next.threadId=null;next.generation++;next.gateEpoch++;next.gate={confirmed:false,checks:{}};next.mediaEvidence={imageReceive:0,imageSend:0};next.paused=true;}});
  }
  history({offset=0,limit=100,q=''}={}){if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>200||typeof q!=='string'||q.length>4000)throw publicError('历史查询格式无效');const records=[...(this.store.data.archivedHistory??[]),...this.store.data.history].filter(m=>!q||m.text?.includes(q));return {total:records.length,items:records.slice().reverse().slice(offset,offset+limit)};}
  async close(){this.closing=true;this.wechat.login=null;this.qrController?.abort();this.pollController?.abort();await this.stop().catch(()=>{});this.images.close();this.codex.close();}
}
