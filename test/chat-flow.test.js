import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {ROOT,AppStore} from '../src/store.js';
import {Assistant} from '../src/assistant.js';
import {ChatFeatures} from '../src/chat-features.js';
import {normalizeMessage} from '../src/wechat.js';
import {CHAT_SCHEMA,parseChatOutput} from '../src/chat-protocol.js';
fs.mkdirSync(path.join(ROOT,'test-output'),{recursive:true});
const base=fs.mkdtempSync(path.join(ROOT,'test-output','chat-flow-'));
const model={model:'test-model',isDefault:true,defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low'}],inputModalities:['text','image'],serviceTiers:[{id:'fast'}]};
const empty=(patch={})=>({reply:'卧槽，真他妈倒霉。\n保持原文  ',memoryOps:[],stickerIds:[],stickerNotes:[],imagePrompt:'',imageSourceMessageId:null,imageSourceImageId:null,...patch});
function setup(output=empty(),generate){
  const root=path.join(base,crypto.randomUUID());fs.mkdirSync(root);const store=new AppStore(path.join(root,'assistant.json'));
  Object.assign(store.data,{owner:{botId:'bot',userId:'owner'},chatReady:true,gate:{confirmed:true,checks:{}},settings:{model:'test-model',reasoningEffort:'low',serviceTier:null,persona:'自然聊天',imageMode:'requested'}});
  const vault={data:{consoleToken:'fixture',contextTokens:{owner:'fixture-context'}},redact:x=>x,save:async()=>{}};
  const features=new ChatFeatures({store,vault,root});const texts=[],pictures=[],calls=[];
  const runtime={state:{state:'ready',models:[model]},run:async(id,input,settings,options)=>{calls.push({input,settings,options});assert.equal(options.outputSchema,CHAT_SCHEMA);options.onThread('own-thread');return {text:JSON.stringify(typeof output==='function'?output():output)};},interrupt:async()=>{},close:()=>{}};
  const images={outputDir:path.join(root,'generated'),state:{},status:()=>({inFlight:false}),cancel:async()=>{},close:()=>{},generate:generate??(async()=>({bytes:Buffer.alloc(30,1),mime:'image/png',path:path.join(root,'generated','00000000-0000-4000-8000-000000000000.png')}))};
  const client={typing:async()=>{},sendText:async(user,text,context,options)=>{assert.ok(options.isCurrent());texts.push(text);return {clientId:crypto.randomUUID(),messageId:String(texts.length),acknowledged:true};},sendImage:async(user,bytes,context,options)=>{assert.ok(options.isCurrent());pictures.push(bytes);return {clientId:crypto.randomUUID(),messageId:'picture-'+pictures.length,acknowledged:true};}};
  const assistant=new Assistant({vault,store,runtime,features,images,client});assistant.wechat.state='connected';
  const receive=async(id='1',text='今天真倒霉')=>assistant.receiveBatch({msgs:[{message_id:id,message_type:1,message_state:2,from_user_id:'owner',context_token:'fixture-context',item_list:[{type:1,text_item:{text}}]}]});
  return {assistant,store,features,runtime,images,texts,pictures,calls,receive};
}
test('full chat sends original reply unchanged and learns memory in the same model call',async()=>{
  const out=empty({memoryOps:[{action:'add',id:null,version:null,text:'主人喜欢雨天在家喝茶',sourceMessageId:'bot/1'}]});
  const f=setup(out);await f.receive('1','请记住我喜欢雨天在家喝茶');await f.assistant.pump();
  assert.equal(f.calls.length,1);assert.deepEqual(f.texts,[out.reply]);assert.equal(f.store.data.features.memory.entries.length,1);
  const context=f.features.context('雨天喝茶');assert.equal(context.memory.entries.length,1);assert.equal(f.store.data.runs[0].learning.memory.applied,1);
});
test('rejected invented memory provenance does not rewrite the spoken reply',async()=>{
  const out=empty({memoryOps:[{action:'add',id:null,version:null,text:'凭空事实',sourceMessageId:'bot/invented'}]});
  const f=setup(out);await f.receive();await f.assistant.pump();assert.deepEqual(f.texts,[out.reply]);assert.equal(f.store.data.features.memory.entries.length,0);assert.equal(f.store.data.runs[0].learning.memory.rejected.length,1);
});
test('invalid structured model result fails without plain text fallback or rerun',async()=>{
  const f=setup();f.runtime.run=async()=>({text:'不是结构化结果'});await f.receive();await f.assistant.pump();await f.assistant.pump();
  assert.equal(f.texts.length,0);assert.equal(f.store.data.runs.length,1);assert.equal(f.store.data.runs[0].status,'failed');
});
test('paused generation prevents applying memory or delivering reply',async()=>{
  const f=setup(empty({memoryOps:[{action:'add',id:null,version:null,text:'不应保存',sourceMessageId:'bot/1'}]}));
  const run=f.runtime.run;f.runtime.run=async(...args)=>{const result=await run(...args);await f.assistant.pause(true);return result;};
  await f.receive();await f.assistant.pump();assert.equal(f.texts.length,0);assert.equal(f.store.data.features.memory.entries.length,0);assert.equal(f.store.data.runs[0].status,'interrupted');
});
test('native image request uses chosen account settings and exact returned bytes',async()=>{
  let request;const bytes=Buffer.alloc(30,7);const f=setup(empty({reply:'我来画一张。',imagePrompt:'一只蓝猫'}),async input=>{request=input;return {bytes,mime:'image/png',path:'F:/Wedex/state/generated/00000000-0000-4000-8000-000000000000.png'};});
  await f.receive('1','画一只蓝猫');await f.assistant.pump();assert.equal(request.settings.model,'test-model');assert.deepEqual(request.sourceImages,[]);assert.deepEqual(f.pictures,[bytes]);assert.equal(f.store.data.runs[0].delivery[1].kind,'generated_image');
});
test('stop during native generation blocks final image delivery and future replay',async()=>{
  let f;f=setup(empty({reply:'正在画。',imagePrompt:'蓝猫'}),async()=>{await f.assistant.stop();return {bytes:Buffer.alloc(30),mime:'image/png',path:'F:/Wedex/state/generated/00000000-0000-4000-8000-000000000000.png'};});
  await f.receive('1','画猫');await f.assistant.pump();await f.assistant.pump();assert.equal(f.pictures.length,0);assert.equal(f.calls.length,1);assert.equal(f.store.data.runs[0].status,'interrupted');
});
test('editing can use the real prior current-owner image without choosing another image',async()=>{
  let request;const f=setup(empty({reply:'我来改。',imagePrompt:'红色背景',imageSourceMessageId:'old-image'}),async input=>{request=input;return {bytes:Buffer.alloc(30),mime:'image/png',path:'F:/Wedex/state/generated/00000000-0000-4000-8000-000000000000.png'};});
  const imageId=crypto.randomUUID(),bytes=Buffer.alloc(30,8);
  f.store.data.history.push({id:crypto.randomUUID(),kind:'user',sourceId:'bot/old-image',messageId:'old-image',text:'',images:[{id:imageId,status:'downloaded'}],status:'processed',time:new Date().toISOString()});
  f.assistant.vault.data.inboundMedia={[imageId]:{sourceId:'bot/old-image',userId:'owner'}};
  f.assistant.loadImage=async id=>{assert.equal(id,imageId);return {bytes,mime:'image/png'};};
  await f.receive('new','把刚才的图换红色背景');await f.assistant.pump();assert.equal(request.sourceImages[0].url,'data:image/png;base64,'+bytes.toString('base64'));
});
test('fabricated or other-binding edit reference never substitutes a real image',async()=>{
  let nativeCalls=0;const f=setup(empty({reply:'我来改图。',imagePrompt:'红色',imageSourceMessageId:'foreign'}),async()=>{nativeCalls++;});
  f.store.data.history.push({kind:'user',sourceId:'other-bot/foreign',messageId:'foreign',images:[{id:crypto.randomUUID(),status:'downloaded'}]});
  await f.receive();await f.assistant.pump();assert.equal(nativeCalls,0);assert.equal(f.pictures.length,0);assert.equal(f.store.data.runs[0].status,'failed');
});
test('disabled image mode reports failure without calling another model or native generator',async()=>{
  let nativeCalls=0;const f=setup(empty({imagePrompt:'一只猫'}),async()=>{nativeCalls++;});f.store.data.settings.imageMode='off';
  await f.receive();await f.assistant.pump();assert.equal(nativeCalls,0);assert.equal(f.calls.length,1);assert.match(f.store.data.runs[0].error,/关闭图片创作/);
});
test('archive restoration history is searchable but never enters processing queue',async()=>{
  const f=setup();f.store.data.archivedHistory=[{kind:'user',text:'旧备份历史',archival:true}];assert.equal(f.assistant.history({q:'旧备份'}).total,1);await f.assistant.pump();assert.equal(f.calls.length,0);
});

test('multi-image edit forwards the exact second image and advertises paired IDs',async()=>{
  const first=crypto.randomUUID(),second=crypto.randomUUID(),bytes=Buffer.alloc(30,19);let request;
  const f=setup(empty({reply:'改第二张。',imagePrompt:'红色背景',imageSourceMessageId:'multi',imageSourceImageId:second}),async input=>{request=input;return {bytes:Buffer.alloc(30),mime:'image/png',path:'F:/Wedex/state/generated/00000000-0000-4000-8000-000000000000.png'};});
  f.store.data.history.push({kind:'user',sourceId:'bot/multi',messageId:'multi',images:[{id:first,status:'downloaded'},{id:second,status:'downloaded'}],status:'processed',time:new Date().toISOString()});
  f.assistant.vault.data.inboundMedia={[first]:{sourceId:'bot/multi',userId:'owner'},[second]:{sourceId:'bot/multi',userId:'owner'}};
  const loaded=[];f.assistant.loadImage=async id=>{loaded.push(id);assert.equal(id,second);return {bytes,mime:'image/png'};};
  await f.receive('new','改第二张');await f.assistant.pump();
  assert.deepEqual(loaded,[second]);assert.equal(request.sourceImages[0].url,'data:image/png;base64,'+bytes.toString('base64'));
  assert.deepEqual(f.calls[0].options.context.imageSources[0].imageIds,[first,second]);assert.equal(f.store.data.runs[0].status,'completed');
});

test('ambiguous multi-image edit without exact image ID fails before native generation',async()=>{
  let calls=0,loads=0;const f=setup(empty({imagePrompt:'换红色',imageSourceMessageId:'multi'}),async()=>{calls++;});
  f.store.data.history.push({kind:'user',sourceId:'bot/multi',messageId:'multi',images:[{id:crypto.randomUUID(),status:'downloaded'},{id:crypto.randomUUID(),status:'downloaded'}],status:'processed',time:new Date().toISOString()});
  f.assistant.loadImage=async()=>{loads++;};await f.receive('new','改图');await f.assistant.pump();
  assert.equal(calls,0);assert.equal(loads,0);assert.match(f.store.data.runs[0].error,/多张参考图.*单张图片.*明确指定/);
});

test('wrong message/image pairing and foreign-owner provenance never substitute another image',async()=>{
  for(const kind of ['wrong-pair','missing-id','foreign-owner','wrong-source']) {
    const selected=crypto.randomUUID(),other=crypto.randomUUID();let calls=0,loads=0;
    const f=setup(empty({imagePrompt:'编辑',imageSourceMessageId:'selected',imageSourceImageId:kind==='wrong-pair'?other:kind==='missing-id'?crypto.randomUUID():selected}),async()=>{calls++;});
    f.store.data.history.push({kind:'user',sourceId:'bot/selected',messageId:'selected',images:[{id:selected,status:'downloaded'}],status:'processed',time:new Date().toISOString()},{kind:'user',sourceId:'bot/other',messageId:'other',images:[{id:other,status:'downloaded'}],status:'processed',time:new Date().toISOString()});
    f.assistant.vault.data.inboundMedia={[selected]:{sourceId:kind==='wrong-source'?'bot/other':'bot/selected',userId:kind==='foreign-owner'?'foreign':'owner'},[other]:{sourceId:'bot/other',userId:'owner'}};
    f.assistant.loadImage=async()=>{loads++;};await f.receive('new','编辑参考图');await f.assistant.pump();
    assert.equal(calls,0,kind);assert.equal(loads,0,kind);assert.match(f.store.data.runs[0].error,/未使用其他图片替代/);
  }
});

test('image source schema requires nullable image ID and pure generation requires both null',()=>{
  assert.ok(CHAT_SCHEMA.required.includes('imageSourceImageId'));assert.deepEqual(CHAT_SCHEMA.properties.imageSourceImageId.type,['string','null']);
  assert.equal(parseChatOutput(JSON.stringify(empty({imagePrompt:'生成一张'}))).imageSourceImageId,null);
  for(const patch of [{imageSourceImageId:undefined},{imageSourceImageId:12},{imagePrompt:'生成一张',imageSourceImageId:crypto.randomUUID()}])assert.throws(()=>parseChatOutput(JSON.stringify(empty(patch))),/聊天结构无效/);
});

test('generated image metadata survives downlink failure and pump never regenerates or resends',async()=>{
  let generated=0,sent=0;
  const imageId='00000000-0000-4000-8000-000000000000.png';
  const f=setup(empty({reply:'图片准备好了。',imagePrompt:'蓝猫'}),async()=>{generated++;return {bytes:Buffer.alloc(30),mime:'image/png',path:'F:/Wedex/state/generated/'+imageId};});
  f.assistant.client.sendImage=async()=>{sent++;assert.deepEqual(f.store.data.runs[0].generatedImages,[{id:imageId,mime:'image/png'}]);throw Object.assign(new Error('fixture downlink lost'),{code:'NETWORK'});};
  await f.receive('1','画蓝猫');await f.assistant.pump();
  const run=f.store.data.runs[0];assert.equal(run.status,'failed');assert.equal(run.deliveryUnknown,true);assert.deepEqual(run.generatedImages,[{id:imageId,mime:'image/png'}]);
  await f.assistant.pump();await f.assistant.pump();assert.equal(generated,1);assert.equal(sent,1);assert.equal(f.calls.length,1);assert.equal(f.store.data.runs.length,1);
});

test('media-only NETWORK and HTTP failures are recorded as unknown delivery without replay',async()=>{
  for(const code of ['NETWORK','HTTP']) {
    let generated=0,sent=0;
    const f=setup(empty({reply:'',imagePrompt:'蓝猫'}),async()=>{generated++;return {bytes:Buffer.alloc(30),mime:'image/png',path:'F:/Wedex/state/generated/00000000-0000-4000-8000-000000000000.png'};});
    f.assistant.client.sendImage=async()=>{sent++;throw Object.assign(new Error('fixture media-only failure'),{code,httpStatus:503});};
    await f.receive('1','只发图片');await f.assistant.pump();await f.assistant.pump();
    const run=f.store.data.runs[0];assert.equal(run.status,'failed');assert.equal(run.reply,'');assert.equal(run.deliveryUnknown,true,code);assert.equal(run.generatedImages.length,1);assert.equal(f.texts.length,0);assert.equal(generated,1);assert.equal(sent,1);
  }
});

test('quoted picture title and real server message ID survive safe normalization and primary input',async()=>{
  const raw={message_id:'quote',message_type:1,message_state:2,from_user_id:'owner',context_token:'fixture-context',item_list:[{type:1,text_item:{text:'把引用的图变蓝'},ref_msg:{title:'图片',svr_id:'old-image',message_item:{image_item:{media:{aes_key:'private-ref-aes',encrypt_query_param:'private-ref-param'}}},private_extra:'private-ref-extra'}}]};
  assert.deepEqual(normalizeMessage(raw,'bot','owner').references,[{text:'图片',messageId:'old-image'}]);
  const f=setup();const imageId=crypto.randomUUID();
  f.store.data.history.push({kind:'user',sourceId:'bot/old-image',messageId:'old-image',text:'原始图片',images:[{id:imageId,status:'downloaded'}],status:'processed',time:new Date().toISOString()});
  await f.assistant.receiveBatch({msgs:[raw]});assert.deepEqual(f.store.data.history.at(-1).references,[{text:'图片',messageId:'old-image'}]);
  await f.assistant.pump();const submitted=JSON.parse(f.calls[0].input[0].text);
  assert.deepEqual(submitted.messages[0].references,[{text:'图片',messageId:'old-image'}]);assert.equal(f.calls[0].options.context.imageSources[0].messageId,'old-image');
  for(const secret of ['private-ref-aes','private-ref-param','private-ref-extra'])assert.equal(JSON.stringify(f.store.data).includes(secret),false);
});

test('reference text is redacted before journal and model input',async()=>{
  const f=setup();f.assistant.vault.redact=text=>text.replaceAll('private-ref-text','[redacted]');
  await f.assistant.receiveBatch({msgs:[{message_id:'quote',message_type:1,message_state:2,from_user_id:'owner',context_token:'fixture-context',item_list:[{type:1,text_item:{text:'引用'},ref_msg:{title:'private-ref-text',svr_id:'old'}}]}]});
  assert.deepEqual(f.store.data.history.at(-1).references,[{text:'[redacted]',messageId:'old'}]);await f.assistant.pump();assert.equal(JSON.stringify(f.calls[0].input).includes('private-ref-text'),false);
});

test('native generation duration is separate from actual text and media sending duration',async()=>{
  const actualNow=Date.now;let clock=actualNow();Date.now=()=>clock;
  try{
    const f=setup(empty({reply:'正在创作。',imagePrompt:'蓝猫'}),async()=>{clock+=50000;return {bytes:Buffer.alloc(30),mime:'image/png',path:'F:/Wedex/state/generated/00000000-0000-4000-8000-000000000000.png'};});
    const text=f.assistant.client.sendText,image=f.assistant.client.sendImage;
    f.assistant.client.sendText=async(...args)=>{clock+=5;return text(...args);};f.assistant.client.sendImage=async(...args)=>{clock+=7;return image(...args);};
    await f.receive('1','画猫');await f.assistant.pump();assert.equal(f.store.data.runs[0].imageMs,50000);assert.equal(f.store.data.runs[0].sendMs,12);assert.equal(f.store.data.runs[0].status,'completed');
  }finally{Date.now=actualNow;}
});

test('failed generation and failed image sending retain separate measured durations without replay',async()=>{
  const actualNow=Date.now;let clock=actualNow();Date.now=()=>clock;
  try{
    const generation=setup(empty({reply:'',imagePrompt:'猫'}),async()=>{clock+=1000;throw Object.assign(new Error('fixture native failure'),{code:'NETWORK'});});
    await generation.receive();await generation.assistant.pump();assert.equal(generation.store.data.runs[0].imageMs,1000);assert.equal(generation.store.data.runs[0].sendMs,0);assert.equal(generation.store.data.runs[0].deliveryUnknown,undefined);
    const sending=setup(empty({reply:'',imagePrompt:'猫'}),async()=>{clock+=2000;return {bytes:Buffer.alloc(30),mime:'image/png',path:'F:/Wedex/state/generated/00000000-0000-4000-8000-000000000000.png'};});
    sending.assistant.client.sendImage=async()=>{clock+=11;throw Object.assign(new Error('fixture lost'),{code:'NETWORK'});};
    await sending.receive();await sending.assistant.pump();await sending.assistant.pump();assert.equal(sending.store.data.runs[0].imageMs,2000);assert.equal(sending.store.data.runs[0].sendMs,11);assert.equal(sending.store.data.runs[0].deliveryUnknown,true);assert.equal(sending.calls.length,1);
  }finally{Date.now=actualNow;}
});

test('source catalog retains newest images and prioritizes a real quote older than the recent window',async()=>{
  const f=setup();for(let index=0;index<25;index++)f.store.data.history.push({kind:'user',sourceId:'bot/history-'+index,messageId:'history-'+index,text:'',images:[{id:crypto.randomUUID(),status:'downloaded'}],status:'processed',time:new Date(Date.UTC(2020,0,1,0,0,index)).toISOString()});
  await f.assistant.receiveBatch({msgs:[{message_id:'quote',message_type:1,message_state:2,from_user_id:'owner',context_token:'fixture-context',item_list:[{type:1,text_item:{text:'改引用的图'},ref_msg:{title:'图片',svr_id:'history-0'}}]}]});await f.assistant.pump();
  const sources=f.calls[0].options.context.imageSources;assert.equal(sources.length,10);assert.equal(sources[0].messageId,'history-0');assert.equal(sources[1].messageId,'history-24');assert.ok(sources.some(s=>s.messageId==='history-23'));assert.equal(new Set(sources.map(s=>s.sourceMessageId)).size,sources.length);
});

test('editing the previous acknowledged generated image loads that exact local asset',async()=>{
  const id=crypto.randomUUID()+'.png',bytes=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(24,3)]);let request;
  const f=setup(empty({reply:'改成蓝色。',imagePrompt:'把背景改蓝',imageSourceMessageId:'delivered-generated',imageSourceImageId:id}),async input=>{request=input;return {bytes,mime:'image/png',path:path.join(f.images.outputDir,crypto.randomUUID()+'.png')};});
  fs.mkdirSync(f.images.outputDir,{recursive:true});fs.writeFileSync(path.join(f.images.outputDir,id),bytes);
  f.store.data.runs.push({id:'generated-run',status:'completed',sourceMessageIds:['bot/previous-request'],startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),generatedImages:[{id,mime:'image/png'}],delivery:[{kind:'generated_image',messageId:'delivered-generated',acknowledged:true}]});
  f.assistant.loadImage=async()=>{throw new Error('must not use inbound fallback');};await f.receive('new','把背景改蓝');await f.assistant.pump();
  assert.equal(request.sourceImages[0].url,'data:image/png;base64,'+bytes.toString('base64'));const source=f.calls[0].options.context.imageSources.find(s=>s.messageId==='delivered-generated');assert.equal(source.kind,'generated');assert.equal(source.runId,'generated-run');assert.deepEqual(source.imageIds,[id]);assert.equal(f.store.data.runs.at(-1).status,'completed');
});

test('foreign-binding and unacknowledged generated assets cannot become edit references',async()=>{
  for(const kind of ['foreign','unacknowledged','unsent']) {
    const id=crypto.randomUUID()+'.png';let calls=0;
    const f=setup(empty({imagePrompt:'编辑',imageSourceMessageId:'delivery-id',imageSourceImageId:id}),async()=>{calls++;});
    f.store.data.runs.push({id:'old-run',sourceMessageIds:[kind==='foreign'?'foreign-bot/old':'bot/old'],startedAt:new Date().toISOString(),generatedImages:[{id,mime:'image/png'}],delivery:kind==='unsent'?[]:[{kind:'generated_image',messageId:'delivery-id',acknowledged:kind!=='unacknowledged'}]});
    await f.receive();await f.assistant.pump();assert.equal(calls,0,kind);assert.equal(f.calls[0].options.context.imageSources.some(s=>s.messageId==='delivery-id'),false);assert.match(f.store.data.runs.at(-1).error,/未使用其他图片替代/);
  }
});

test('busy queue exceeding memory frame bounds is processed in order without losing the tail',async()=>{
  const f=setup();for(let i=0;i<14;i++)await f.receive(String(i+1),'甲'.repeat(4000));await f.assistant.pump();
  assert.equal(f.calls.length,2);
  const sizes=f.calls.map(c=>JSON.parse(c.input[0].text).messages.length);assert.deepEqual(sizes,[12,2]);
  assert.equal(f.store.data.history.filter(m=>m.kind==='user'&&m.status==='processed').length,14);
  assert.deepEqual(f.calls.flatMap(c=>JSON.parse(c.input[0].text).messages.map(m=>m.id)),Array.from({length:14},(_,i)=>String(i+1)));
});
test('a single oversized queued source fails explicitly while later valid messages still run',async()=>{
  const f=setup();await f.receive('too-long','甲'.repeat(50001));await f.receive('next','你好');await f.assistant.pump();
  assert.equal(f.calls.length,1);assert.equal(f.store.data.history.find(m=>m.messageId==='too-long').status,'failed');assert.equal(f.store.data.history.find(m=>m.messageId==='next').status,'processed');
});


test('new startup messages stay queued and ready event chooses defaults then processes once',async()=>{
  const f=setup();f.runtime.state.state='starting';Object.assign(f.store.data.settings,{model:null,reasoningEffort:null,serviceTier:null});
  await f.receive('startup','启动时的新消息');assert.equal(f.store.data.history[0].status,'queued');await f.assistant.pump();assert.equal(f.calls.length,0);assert.equal(f.store.data.runs.length,0);
  f.runtime.state.state='ready';await f.assistant.accountChanged();assert.equal(f.store.data.settings.model,model.model);assert.equal(f.store.data.settings.reasoningEffort,model.defaultReasoningEffort);assert.equal(f.calls.length,1);assert.equal(f.store.data.history[0].status,'processed');assert.deepEqual(f.texts,[empty().reply]);
  await f.assistant.accountChanged();assert.equal(f.calls.length,1);assert.equal(f.store.data.runs.length,1);
});

test('login-required arrivals queue without model submission before login readiness',async()=>{
  const f=setup();f.runtime.state.state='login_required';await f.receive('login-pending','登录完成后回答');
  assert.equal(f.store.data.history[0].status,'queued');await f.assistant.accountChanged();await f.assistant.pump();assert.equal(f.calls.length,0);assert.equal(f.store.data.runs.length,0);
  f.runtime.state.state='ready';await f.assistant.accountChanged();assert.equal(f.calls.length,1);assert.equal(JSON.parse(f.calls[0].input[0].text).messages[0].id,'login-pending');
});

test('account readiness never requeues old interrupted failed or paused messages',async()=>{
  const f=setup();for(const status of ['interrupted','failed','paused'])f.store.data.history.push({id:crypto.randomUUID(),kind:'user',sourceId:'bot/old-'+status,messageId:'old-'+status,text:'旧消息 '+status,images:[],references:[],time:new Date().toISOString(),status});
  f.runtime.state.state='starting';await f.receive('fresh','仅处理本次未提交的新消息');f.runtime.state.state='ready';await f.assistant.accountChanged();
  assert.deepEqual(JSON.parse(f.calls[0].input[0].text).messages.map(m=>m.id),['fresh']);assert.deepEqual(f.store.data.history.slice(0,3).map(m=>m.status),['interrupted','failed','paused']);assert.equal(f.calls.length,1);
});

test('paused arrivals retain paused state through account readiness',async()=>{
  const f=setup();f.store.data.paused=true;f.runtime.state.state='starting';await f.receive('paused-new','暂停期间');assert.equal(f.store.data.history[0].status,'paused');
  f.runtime.state.state='ready';await f.assistant.accountChanged();assert.equal(f.calls.length,0);assert.equal(f.store.data.history[0].status,'paused');
});

test('account callback waits for constructor fields and surfaces pump rejection without retry',async()=>{
  const partial=Object.create(Assistant.prototype);partial.codex={state:{state:'ready'}};partial.store={data:{settings:{model:null}}};partial.pump=()=>{throw new Error('must not pump partial constructor');};assert.doesNotThrow(()=>partial.accountChanged());
  const f=setup();let calls=0;f.assistant.pump=async()=>{calls++;throw Object.assign(new Error('fixture public error'),{publicMessage:'队列准备失败，请检查本地状态'});};
  await f.assistant.accountChanged();assert.equal(calls,1);assert.equal(f.runtime.state.error,'队列准备失败，请检查本地状态');assert.equal(f.store.data.runs.length,0);
});
