import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {ROOT,AppStore,atomicJson,losslessJson} from '../src/store.js';
import {normalizeMessage,WechatClient,trustedUrl,parseAesKey} from '../src/wechat.js';
import {Assistant,splitText} from '../src/assistant.js';
import {CodexRuntime,validateSettings,codexEnvironment} from '../src/codex.js';
import {protect} from '../src/secrets.js';

fs.mkdirSync(path.join(ROOT,'test-output'),{recursive:true});
const dir=fs.mkdtempSync(path.join(ROOT,'test-output','stage1-'));
const model={model:'test-model',isDefault:true,defaultReasoningEffort:'medium',defaultServiceTier:null,supportedReasoningEfforts:[{reasoningEffort:'medium'}],inputModalities:['text','image'],serviceTiers:[{id:'priority'}]};
test('fresh public installation opens chat features without inventing phone acceptance',()=>{
  const store=new AppStore(path.join(dir,crypto.randomUUID()+'.json'));
  assert.equal(store.data.chatReady,true);
  assert.equal(store.data.gate.confirmed,false);
  assert.equal(store.data.owner,null);
  assert.equal(store.data.history.length,0);
});
function fixture({run,send}={}){
  const store=new AppStore(path.join(dir,crypto.randomUUID()+'.json'));store.data.chatReady=false;
  store.data.owner={botId:'test-bot',userId:'owner'};store.data.settings={model:'test-model',reasoningEffort:'medium',serviceTier:null,persona:'自然吐槽'};
  const events=[],sent=[];
  const vault={data:{consoleToken:'dummy-console',contextTokens:{owner:'dummy-context'}},save:async()=>{events.push('secrets');},redact:s=>s};
  const runtime={state:{state:'ready',models:[model]},run:run??(async(id,input,settings,options)=>{options.onThread('owned-thread');return {text:'卧槽，这破事真离谱。',threadId:'owned-thread'};}),interrupt:async()=>{},close:()=>{}};
  const client={typing:async()=>{},sendText:send??(async(userId,text,context,options)=>{assert.equal(options.isCurrent(),true);sent.push(text);return {acknowledged:true,clientId:'dummy-id',messageId:'9007199254740993'};})};
  const assistant=new Assistant({vault,store,runtime,client});assistant.wechat.state='connected';
  const original=store.save.bind(store);store.save=()=>{events.push('journal');original();};
  return {assistant,store,vault,events,sent,client,runtime};
}
function message(id='1',extra={}){return {message_id:id,message_type:1,message_state:2,from_user_id:'owner',context_token:'dummy-context',item_list:[{type:1,text_item:{text:'你好'}}],...extra};}
test('uint64 IDs are preserved from JSON without hashing',()=>{
  const parsed=losslessJson('{"message_id":18446744073709551615,"seq":2}');
  assert.equal(parsed.message_id,'18446744073709551615');assert.equal(parsed.seq,2);
});
test('owner-only direct complete user messages are admitted',()=>{
  assert.equal(normalizeMessage(message('1',{from_user_id:'other'}),'bot','owner'),null);
  assert.equal(normalizeMessage(message('1',{group_id:'group'}),'bot','owner'),null);
  assert.equal(normalizeMessage(message('1',{message_state:1}),'bot','owner'),null);
  assert.equal(normalizeMessage(message(),'bot','owner').sourceId,'bot/1');
});
test('journal and encrypted media precede cursor; duplicate message not requeued',async()=>{
  const {assistant,store,events}=fixture();
  const raw=message('1',{item_list:[{type:1,text_item:{text:'卧槽'}},{type:2,image_item:{media:{aes_key:'dummy-key',encrypt_query_param:'dummy-param'}}}]});
  await assistant.receiveBatch({msgs:[raw],get_updates_buf:'cursor-1'});
  assert.deepEqual(events,['secrets','journal']);
  assert.equal(store.data.cursor,'cursor-1');assert.equal(store.data.history.length,1);
  assert.equal(JSON.stringify(store.data).includes('dummy-key'),false);
  await assistant.receiveBatch({msgs:[raw],get_updates_buf:'cursor-2'});
  assert.equal(store.data.history.length,1);assert.equal(store.data.cursor,'cursor-2');
});
test('vault failure does not advance cursor or journal',async()=>{
  const {assistant,store,vault}=fixture();vault.save=async()=>{throw Error('simulated DPAPI failure');};
  await assert.rejects(assistant.receiveBatch({msgs:[message()],get_updates_buf:'new'}));
  assert.equal(store.data.cursor,'');assert.equal(store.data.history.length,0);
});
test('model reply profanity and Unicode are sent unchanged',async()=>{
  const {assistant,sent,store}=fixture();await assistant.receiveBatch({msgs:[message()],get_updates_buf:'c'});
  await assistant.pump();assert.deepEqual(sent,['卧槽，这破事真离谱。']);assert.equal(store.data.runs[0].status,'completed');
  const text='脏话不删改🙂'.repeat(1000);const parts=splitText(text);assert.equal(parts.join(''),text);
  assert.ok(parts.every(p=>p.length<=4000));assert.ok(parts.every(p=>!/[\\uD800-\\uDBFF]$/.test(p)));
});
test('pause during thread preparation prevents model start/send; paused input not replayed',async()=>{
  let proceed;const ready=new Promise(r=>{proceed=r;});
  const f=fixture({run:async(id,input,settings,options)=>{await ready;if(!options.isCurrent())throw Error('stopped');return {text:'late reply'};}});
  await f.assistant.receiveBatch({msgs:[message()],get_updates_buf:'c'});const running=f.assistant.pump();
  await f.assistant.pause(true);proceed();await running;assert.equal(f.sent.length,0);
  await f.assistant.receiveBatch({msgs:[message('2')],get_updates_buf:'c2'});await f.assistant.pause(false);await f.assistant.pump();
  assert.equal(f.sent.length,0);assert.equal(f.store.data.history[1].status,'paused');
});
test('send failures do not automatically regenerate or resend',async()=>{
  let calls=0;
  const f=fixture({send:async()=>{calls++;const e=Error('network');e.code='NETWORK';throw e;}});
  await f.assistant.receiveBatch({msgs:[message()],get_updates_buf:'c'});await f.assistant.pump();await f.assistant.pump();
  assert.equal(calls,1);assert.equal(f.store.data.runs.length,1);assert.equal(f.store.data.runs[0].deliveryUnknown,true);
});
test('model/effort/speed selections are validated against account catalog',()=>{
  const settings={model:'test-model',reasoningEffort:'medium',serviceTier:null,persona:'p'};
  assert.equal(validateSettings(settings,[model]),model);
  assert.throws(()=>validateSettings({...settings,model:'not-available'},[model]));
  assert.throws(()=>validateSettings({...settings,reasoningEffort:'ultra'},[model]));
  assert.throws(()=>validateSettings({...settings,serviceTier:'not-available'},[model]));
  assert.doesNotThrow(()=>validateSettings({...settings,serviceTier:'priority'},[model]));
});
test('unconfirmed model execution cannot be unlocked by account refresh',async()=>{
  const runtime=Object.create(CodexRuntime.prototype);runtime.needsRestart=true;let calls=0;runtime.request=async()=>{calls++;return {};};
  await assert.rejects(runtime.refresh(),/重启/);assert.equal(calls,0);
});
test('cancel while uploading prevents sendmessage',async()=>{
  let current=true,calls=0;
  const client=new WechatClient({connection:()=>({botToken:'dummy',baseUrl:'https://ilinkai.weixin.qq.com'}),fetchImpl:async()=>{current=false;return new Response('',{status:200,headers:{'x-encrypted-param':'dummy'}});}});
  client.request=async route=>{if(route.includes('getuploadurl'))return {upload_full_url:'https://novac2c.cdn.weixin.qq.com/c2c/upload'};calls++;return {ret:0};};
  const png=Buffer.from([137,80,78,71,13,10,26,10]);
  await assert.rejects(client.sendImage('owner',png,'dummy',{isCurrent:()=>current}),/停止/);
  assert.equal(calls,0);
});
test('late typing is rejected by current-run guard',async()=>{
  let sends=0;const client=new WechatClient();client.request=async route=>{if(route.includes('getconfig'))return {typing_ticket:'dummy'};sends++;return {};};
  await client.typing('owner','dummy',1,{isCurrent:()=>false});assert.equal(sends,0);
});
test('old model/persona gate evidence cannot confirm new settings',()=>{
  const {assistant,store}=fixture();
  store.data.runs=[1,2,3].map(id=>({id:String(id),gateEpoch:0,status:'completed',phoneConfirmed:true}));
  store.data.mediaEvidence={imageReceive:1,imageSend:1};
  const checks={persona:true,continuous:true,imageReceive:true,imageSend:true};
  assistant.confirmGate({confirmed:true,checks});assert.equal(store.data.gate.confirmed,true);
  assistant.saveSettings({...store.data.settings,persona:'新人格'});assert.equal(store.data.gate.confirmed,false);
  assert.throws(()=>assistant.confirmGate({confirmed:true,checks}),/3 轮/);
});
test('live API ack alone cannot pass phone acceptance',()=>{
  const {assistant,store}=fixture();
  store.data.runs=[1,2,3].map(id=>({id:String(id),gateEpoch:0,status:'completed',phoneConfirmed:null}));
  store.data.mediaEvidence={imageReceive:1,imageSend:1};
  assert.throws(()=>assistant.confirmGate({confirmed:true,checks:{persona:true,continuous:true,imageReceive:true,imageSend:true}}),/3 轮/);
});
test('trusted endpoints reject unrelated domains, credentials and local network addresses',()=>{
  assert.throws(()=>trustedUrl('https://127.0.0.1/'));assert.throws(()=>trustedUrl('https://attacker.example/'));
  assert.throws(()=>trustedUrl('https://name:pass@ilinkai.weixin.qq.com/'));assert.throws(()=>trustedUrl('http://ilinkai.weixin.qq.com/'));
  assert.equal(trustedUrl('https://ilinkai.weixin.qq.com/').hostname,'ilinkai.weixin.qq.com');
});
test('AES key decoding matches Tencent raw/hex base64 encodings',()=>{
  const key=crypto.randomBytes(16);assert.deepEqual(parseAesKey(key.toString('base64')),key);
  assert.deepEqual(parseAesKey(Buffer.from(key.toString('hex')).toString('base64')),key);
  assert.throws(()=>parseAesKey(Buffer.from('bad').toString('base64')));
});
test('isolated Codex environment removes other bot and API credentials',()=>{
  const env=codexEnvironment({CODEX_HOME:'old',QBOT_TOKEN:'dummy',OPENAI_API_KEY:'dummy',PATH:'p',openai_api_key:'fixture',CoDeX_HOME:'foreign',qBoT_TOKEN:'fixture',OpenAi_Base_Url:'https://example.invalid',chatgpt_token:'fixture',snowLuma_token:'fixture'});
  assert.equal(env.PATH,'p');assert.equal(env.OPENAI_API_KEY,undefined);assert.equal(env.QBOT_TOKEN,undefined);
  assert.equal(env.CODEX_HOME,path.join(ROOT,'codex-home'));
  for(const key of ['openai_api_key','CoDeX_HOME','qBoT_TOKEN','OpenAi_Base_Url','chatgpt_token','snowLuma_token'])assert.equal(env[key],undefined);
});
test('restart marks unfinished work interrupted and does not resend',()=>{
  const file=path.join(dir,crypto.randomUUID()+'.json');const store=new AppStore(file);
  store.data.history.push({id:'m',status:'queued'});store.data.runs.push({id:'r',status:'sending'});store.data.threadId='owned';store.save();
  const restored=new AppStore(file);assert.equal(restored.data.history[0].status,'interrupted');assert.equal(restored.data.runs[0].status,'interrupted');assert.equal(restored.data.threadId,null);
});
test('corrupted stored state is not silently reset or overwritten',()=>{
  const file=path.join(dir,crypto.randomUUID()+'.json');fs.writeFileSync(file,'invalid-json');
  assert.throws(()=>new AppStore(file));assert.equal(fs.readFileSync(file,'utf8'),'invalid-json');
});
test('Windows DPAPI round trip encrypts fixture without plaintext output',{skip:process.platform!=='win32'},async()=>{
  const fixture='test-fixture-not-a-real-credential';const sealed=await protect('seal',fixture);
  assert.notEqual(sealed,fixture);assert.equal(sealed.includes(fixture),false);assert.equal(await protect('open',sealed),fixture);
});

test('in-flight refresh cannot clear a newly poisoned runtime',async()=>{
  const runtime=Object.create(CodexRuntime.prototype);runtime.initialized=true;runtime.state={state:'ready'};runtime.onChange=()=>{};
  let release;const held=new Promise(r=>{release=r;});
  runtime.request=async method=>method==='account/read'?held:method==='model/list'?{data:[model],nextCursor:null}:{};
  const refresh=runtime.refresh();runtime.needsRestart=true;runtime.state.state='error';
  release({account:{type:'chatgpt',planType:'test'}});
  await assert.rejects(refresh,/重启/);assert.equal(runtime.state.state,'error');
});
test('run refuses a poisoned runtime even if stale status says ready',async()=>{
  const runtime=Object.create(CodexRuntime.prototype);runtime.ready=Promise.resolve();runtime.needsRestart=true;runtime.state={state:'ready'};
  await assert.rejects(runtime.run(null,[],{}),/重启/);
});
test('QR confirmation arriving after close cannot bind or restart polling',async()=>{
  const f=fixture();let release;const held=new Promise(r=>{release=r;});let saved=0,restarted=0;
  f.client.qrStatus=async()=>held;f.vault.save=async()=>{saved++;};f.assistant.startPolling=()=>{restarted++;};
  const login={state:'wait',qrcode:'dummy',baseUrl:'https://ilinkai.weixin.qq.com',started:Date.now(),code:null};
  f.assistant.wechat.login=login;const pending=f.assistant.pollQr(login);
  await f.assistant.close();release({status:'confirmed',bot_token:'dummy',ilink_bot_id:'new-bot',ilink_user_id:'owner'});
  await pending;assert.equal(saved,0);assert.equal(restarted,0);assert.equal(f.store.data.owner.botId,'test-bot');
});

test('structured quote restores the precise sent segment rather than the entire reply',async()=>{
  const {assistant,store}=fixture();
  store.data.runs.push({id:'outgoing',sourceMessageIds:['test-bot/earlier'],reply:'first\nsecond',delivery:[{messageId:'out-1',acknowledged:true,text:'first'},{messageId:'out-2',acknowledged:true,text:'second'}]});
  await assistant.receiveBatch({msgs:[message('quote',{item_list:[{type:1,text_item:{text:'解释这句话'},ref_msg:{svr_id:'out-2'}}]})]});
  assert.equal(store.data.history[0].text,'解释这句话\n[引用材料] second');
});
test('structured inbound quotes use the currently bound bot message ID',async()=>{
  const {assistant,store}=fixture();
  await assistant.receiveBatch({msgs:[message('original',{item_list:[{type:1,text_item:{text:'真实原文'}}]}),message('quote',{item_list:[{type:1,text_item:{text:'继续'},ref_msg:{svr_id:'original'}}]})]});
  assert.equal(store.data.history[1].text,'继续\n[引用材料] 真实原文');
});
test('quote IDs from another bot cannot restore unrelated history or deliveries',async()=>{
  const {assistant,store}=fixture();
  store.data.history.push({kind:'user',sourceId:'other-bot/collision',messageId:'collision',text:'别的绑定原文'});
  store.data.runs.push({sourceMessageIds:['other-bot/source'],delivery:[{messageId:'collision',acknowledged:true,text:'别的绑定回复'}]});
  await assistant.receiveBatch({msgs:[message('quote',{item_list:[{type:1,text_item:{text:'解释'},ref_msg:{svr_id:'collision'}}]})]});
  assert.equal(store.data.history[1].text,'解释\n[引用消息 ID: collision] [本地没有原文，不能猜测]');
});
test('typed quote markers are ordinary user text, never treated as WeChat references',async()=>{
  const {assistant,store}=fixture();
  store.data.history.push({kind:'user',sourceId:'test-bot/original',messageId:'original',text:'真实原文'});
  const typed='[引用消息 ID: original]';
  await assistant.receiveBatch({msgs:[message('typed',{item_list:[{type:1,text_item:{text:typed}}]})]});
  assert.equal(store.data.history[1].text,typed);
});
