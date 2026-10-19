import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {CodexRuntime, validateSettings} from './codex.js';
import {ROOT, CODEX_HOME, publicError} from './store.js';

export const MAX_NATIVE_IMAGE_BYTES = 15_000_000;
const FORMATS = {'image/png':'png', 'image/jpeg':'jpg', 'image/webp':'webp'};
function failure(message) { return publicError(message); }
function format(bytes) {
  if(bytes.length < 16 || bytes.length > MAX_NATIVE_IMAGE_BYTES) throw failure('原生图片大小无效或超过 15 MB');
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if(bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if(bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP') return 'image/webp';
  throw failure('原生结果不是支持的 PNG、JPEG 或 WebP 图片');
}
function decode(value, requireDataUrl = false) {
  if(typeof value !== 'string' || value.length > MAX_NATIVE_IMAGE_BYTES * 4 / 3 + 100) throw failure('原生图片数据无效');
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if(requireDataUrl && !match) throw failure('编辑参考图不可用：必须提供 PNG、JPEG 或 WebP 的 data URL');
  const encoded = match ? match[2] : value;
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw failure('原生图片数据格式无效');
  const bytes = Buffer.from(encoded,'base64');
  if(bytes.toString('base64') !== encoded) throw failure('原生图片 Base64 数据无效');
  const mime = format(bytes);
  if(match && match[1] !== mime) throw failure('原生图片格式与声明不符');
  return {bytes,mime};
}
export function readNativeImage({savedPath,result} = {}, codexHome = CODEX_HOME) {
  if(savedPath !== undefined && savedPath !== null && savedPath !== '') {
    if(typeof savedPath !== 'string' || !path.isAbsolute(savedPath)) throw failure('原生图片路径无效');
    let root, source;
    try { root=fs.realpathSync(path.join(codexHome,'generated_images')); source=fs.realpathSync(savedPath); }
    catch { throw failure('原生图片文件不可读取'); }
    const relative=path.relative(root,source);
    if(!relative || relative === '..' || relative.startsWith('..'+path.sep) || path.isAbsolute(relative)) throw failure('原生图片文件不在独立 Codex 生成目录');
    const fd=fs.openSync(source,'r');
    try {
      const stat=fs.fstatSync(fd);
      if(!stat.isFile() || stat.size < 16 || stat.size > MAX_NATIVE_IMAGE_BYTES) throw failure('原生图片文件大小无效');
      const buffer=Buffer.alloc(MAX_NATIVE_IMAGE_BYTES+1);
      let count=0;
      while(count < buffer.length) { const n=fs.readSync(fd,buffer,count,buffer.length-count,null); if(!n) break; count+=n; }
      const bytes=buffer.subarray(0,count);
      return {bytes,mime:format(bytes)};
    } finally { fs.closeSync(fd); }
  }
  return decode(result);
}

// Metadata must come from a stored native run, never from a caller-selected path.
export function readGeneratedImage(metadata, outputDir=path.join(ROOT,'state','generated')) {
  if(!metadata||typeof metadata.id!=='string'||!/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(png|jpg|webp)$/i.test(metadata.id)||!FORMATS[metadata.mime]||!metadata.id.endsWith('.'+FORMATS[metadata.mime])) throw failure('生成参考图记录无效，未使用其他图片替代');
  let root,source;
  try{root=fs.realpathSync(outputDir);source=fs.realpathSync(path.join(outputDir,metadata.id));}catch{throw failure('生成参考图文件不可读取，未使用其他图片替代');}
  const relative=path.relative(root,source);
  if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw failure('生成参考图路径不在独立生成目录');
  const fd=fs.openSync(source,'r');
  try{
    const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size<16||stat.size>MAX_NATIVE_IMAGE_BYTES)throw failure('生成参考图大小无效');
    const buffer=Buffer.alloc(MAX_NATIVE_IMAGE_BYTES+1);let count=0;
    while(count<buffer.length){const size=fs.readSync(fd,buffer,count,buffer.length-count,null);if(!size)break;count+=size;}
    const bytes=buffer.subarray(0,count),mime=format(bytes);if(mime!==metadata.mime)throw failure('生成参考图格式与记录不符');
    return {bytes,mime};
  }finally{fs.closeSync(fd);}
}

export class NativeImages {
  constructor({runtime,onStatus=()=>{},timeoutMs=180000,codexHome=CODEX_HOME,outputDir=path.join(ROOT,'state','generated')}={}) {
    this.runtime=runtime??null; this.owned=!runtime; this.onStatus=onStatus; this.timeoutMs=timeoutMs;
    this.codexHome=codexHome; this.outputDir=outputDir; this.active=null; this.closed=false;
    this.state={status:'idle',error:null};
    if(runtime) this.attach(runtime);
  }
  attach(runtime) {
    this.previousNotification=runtime.onNotification;
    this.notification=(method,params)=>{ this.notify(method,params); try { this.previousNotification?.(method,params); } catch {} };
    runtime.onNotification=this.notification;
  }
  ensureRuntime() {
    if(!this.runtime) {
      this.runtime=new CodexRuntime({imageGeneration:true,onNotification:(method,params)=>this.notify(method,params)});
    }
    return this.runtime;
  }
  status() {
    return {...this.state,available:!this.closed&&!this.active,inFlight:!!this.active,uncertain:!!this.active?.uncertain};
  }
  publish(status,error=null,job=this.active) {
    this.state={status,error};
    const meta=this.status();
    try { this.onStatus(meta); } catch {}
    try { job?.onStatus?.(status); } catch {}
  }
  current(job) {
    if(this.closed || job.cancelled || job.uncertain || this.active!==job) return false;
    try { return job.isCurrent()===true; } catch { return false; }
  }
  generate({prompt,sourceImages=[],settings,isCurrent=()=>true,onStatus}={}) {
    if(this.closed) return Promise.reject(failure('原生图片进程已关闭'));
    if(this.active) return Promise.reject(failure('原生图片任务仍在处理中或状态未确认，未自动重跑'));
    let images;
    try {
      if(typeof prompt!=='string'||!prompt.trim()||prompt.length>20000) throw failure('图片需求必须是最多 20000 字符的文字');
      if(!Array.isArray(sourceImages)||sourceImages.length>3) throw failure('最多提供三张编辑参考图');
      images=sourceImages.map(image=>{ decode(image?.url,true); return {type:'image',url:image.url}; });
      if(!settings || typeof isCurrent!=='function') throw failure('原生图片设置无效');
    } catch(error) { return Promise.reject(error); }
    let resolve,reject;
    const promise=new Promise((a,b)=>{resolve=a;reject=b;});
    const job={prompt,images,settings:{...settings,persona:settings.persona??''},isCurrent,onStatus,resolve,reject,events:[],results:[],threadId:null,turnId:null,cancelled:false,settled:false,uncertain:false,submitted:false,terminated:false};
    this.active=job; this.publish('starting',null,job);
    job.timer=setTimeout(()=>this.timeout(job),this.timeoutMs);
    void this.start(job);
    return promise;
  }
  settle(job,error,value) {
    if(job.settled) return;
    job.settled=true;
    if(error) job.reject(error); else job.resolve(value);
  }
  release(job) {
    clearTimeout(job.timer);
    if(this.active===job) this.active=null;
  }
  async start(job) {
    try {
      const runtime=this.ensureRuntime(); await runtime.ready;
      if(!this.current(job)) { if(job.uncertain) return; this.release(job); this.settle(job,failure('图片生成已取消')); return; }
      if(runtime.closed||runtime.needsRestart||runtime.state?.state!=='ready') throw failure('请先完成 Codex 官方登录并确认原生图片进程状态');
      const model=validateSettings(job.settings,runtime.state.models);
      if(job.images.length && !(model.inputModalities??['text','image']).includes('image')) throw failure('当前模型不支持编辑参考图，未替换图片');
      job.threadRequested=true;
      const thread=await runtime.request('thread/start',{ephemeral:true,model:job.settings.model,serviceTier:job.settings.serviceTier,allowProviderModelFallback:false,config:{features:{image_generation:true},web_search:'disabled'},cwd:path.join(ROOT,'state','agents'),environments:[],selectedCapabilityRoots:[],sandbox:'read-only',approvalPolicy:'never',baseInstructions:'Create or edit exactly one image using the native image generation tool. Use only the supplied references for edits. If a reference cannot be used, fail explicitly and never substitute unrelated images. Do not use shell, code, web search, plugins, external services, or other tools.',dynamicTools:[]});
      job.threadId=thread.thread?.id;
      if(typeof job.threadId!=='string'||!job.threadId || (thread.model&&thread.model!==job.settings.model)) throw failure('原生图片会话或模型与请求不符');
      if(!this.current(job)) { if(job.uncertain) return; this.release(job); this.settle(job,failure('图片生成已取消')); return; }
      job.submitted=true;
      const started=await runtime.request('turn/start',{threadId:job.threadId,model:job.settings.model,effort:job.settings.reasoningEffort,serviceTier:job.settings.serviceTier,serviceTierForTurn:job.settings.serviceTier??'default',environments:[],input:[{type:'text',text:`请用原生图片生成工具完成一张图片。需求：${job.prompt}\n${job.images.length?'必须在附加参考图基础上编辑；参考图不可用时明确失败，不得替换成无关图片。':'只生成一张图片。'} 不执行代码或调用外部服务。`,text_elements:[]},...job.images]},60000);
      if(typeof started.turn?.id!=='string'||!started.turn.id) throw failure('原生图片回合没有返回有效编号');
      job.turnId=started.turn.id;
      for(const event of job.events.splice(0)) this.consume(job,event.method,event.params);
      if(this.active===job && (job.cancelled||job.uncertain||!this.current(job))) {
        if(!job.cancelled&&!job.uncertain) this.cancel();
        void this.interrupt(job);
      }
    } catch(error) {
      if(this.active!==job) return;
      if(!job.threadRequested && !job.uncertain) { this.release(job); this.publish('error',error.publicMessage??'原生图片初始化失败',job); this.settle(job,failure(this.state.error)); return; }
      // A failed RPC can have reached the native process. Keep the slot reserved.
      job.uncertain=true;
      const started=job.events.find(event=>event.method==='turn/started'&&typeof event.params.turn?.id==='string');
      if(!job.turnId&&started) job.turnId=started.params.turn.id;
      this.publish(job.cancelled?'cancelled':'unavailable',job.cancelled?'图片生成已取消，等待原生回合终止':'原生图片状态未确认，请等待终止或重启助手；未自动重跑',job);
      this.settle(job,job.cancelled?failure('图片生成已取消'):failure(this.state.error));
      if(job.turnId) {
        for(const event of job.events.splice(0)) this.consume(job,event.method,event.params);
        if(this.active===job) void this.interrupt(job);
      }
    }
  }
  notify(method,params={}) {
    const job=this.active;
    if(!job) return;
    if(method==='connection/lost') {
      job.uncertain=true; this.publish('unavailable','原生图片连接已断开，请重启助手；未自动重跑',job);
      this.settle(job,failure(this.state.error)); return;
    }
    if(!job.threadId || params.threadId!==job.threadId) return;
    if(!job.turnId) { if(['turn/started','turn/completed','item/started','item/completed'].includes(method)) job.events.push({method,params}); return; }
    this.consume(job,method,params);
  }
  consume(job,method,params) {
    if(this.active!==job || (params.turnId??params.turn?.id)!==job.turnId) return;
    if(method==='item/started'&&params.item?.type==='imageGeneration'&&!job.cancelled&&!job.uncertain) this.publish('generating',null,job);
    if(method==='item/completed'&&params.item?.type==='imageGeneration') {
      if(params.item.status==='completed'&&!params.item.failure) job.results.push({savedPath:params.item.savedPath,result:params.item.result});
      else job.failed=true;
    }
    if(method!=='turn/completed') return;
    job.terminated=true; clearTimeout(job.timer);
    if(job.cancelled||job.uncertain||!this.current(job)) {
      const error=job.uncertain?'图片生成超时或状态未确认，本轮结果已丢弃，未自动重跑':'图片生成已取消';
      this.release(job); this.publish(job.cancelled?'cancelled':'error',error,job); this.settle(job,failure(error)); return;
    }
    let file;
    try {
      if(params.turn.status!=='completed'||job.failed||!job.results.length) throw failure('原生图片生成未成功返回图片，未自动重试');
      const image=readNativeImage(job.results[0],this.codexHome);
      if(!this.current(job)) throw failure('图片生成已取消');
      fs.mkdirSync(this.outputDir,{recursive:true});
      file=path.join(this.outputDir,crypto.randomUUID()+'.'+FORMATS[image.mime]);
      fs.writeFileSync(file,image.bytes,{flag:'wx'});
      this.publish('completed',null,job);
      if(!this.current(job)) throw failure('图片生成已取消');
      this.release(job); this.settle(job,null,{...image,path:file});
    } catch(error) {
      if(file) { try { fs.unlinkSync(file); } catch {} }
      this.release(job); this.publish(job.cancelled?'cancelled':'error',error.publicMessage??'原生图片文件验证或保存失败',job); this.settle(job,error.publicMessage?error:failure(this.state.error));
    }
  }
  timeout(job) {
    if(this.active!==job) return;
    job.uncertain=true;
    this.publish('timeout','图片生成超时，等待原生回合终止或重启助手；未自动重跑',job);
    this.settle(job,failure(this.state.error)); void this.interrupt(job);
  }
  async interrupt(job) {
    if(!job.threadId||!job.turnId||job.terminated||this.closed||job.interruptSent) return;
    job.interruptSent=true;
    try { await this.runtime.request('turn/interrupt',{threadId:job.threadId,turnId:job.turnId}); }
    catch { if(this.active===job) { job.uncertain=true; this.publish('unavailable','原生图片停止状态未确认，请等待终止或重启助手',job); } }
  }
  async cancel() {
    const job=this.active; if(!job) return;
    job.cancelled=true; this.publish('cancelled','图片生成已取消，等待原生回合终止',job);
    this.settle(job,failure('图片生成已取消')); await this.interrupt(job);
  }
  close() {
    if(this.closed) return;
    this.closed=true;
    const job=this.active;
    if(job) { job.cancelled=true; this.release(job); this.settle(job,failure('原生图片进程已关闭，本轮结果已丢弃')); }
    if(this.owned) this.runtime?.close();
    else if(this.runtime?.onNotification===this.notification) this.runtime.onNotification=this.previousNotification;
    this.publish('closed','原生图片进程已关闭',job);
  }
}
