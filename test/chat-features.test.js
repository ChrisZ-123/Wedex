import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {ChatFeatures} from '../src/chat-features.js';

const OUTPUT=fileURLToPath(new URL('../test-output/chat-features/',import.meta.url));
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1cAAAAASUVORK5CYII=','base64');
const MODELS=[{model:'model-test',supportedReasoningEfforts:[{reasoningEffort:'high'}],serviceTiers:['priority'],additionalSpeedTiers:['fast'],defaultServiceTier:'priority'}];
function fixture() {
  const root=path.join(OUTPUT,crypto.randomUUID());fs.mkdirSync(root,{recursive:true});
  const user={id:crypto.randomUUID(),kind:'user',sourceId:'bot-test/111',messageId:'111',text:'我喜欢喝茶',time:new Date().toISOString(),status:'processing'};
  const run={id:crypto.randomUUID(),status:'completed',sourceMessageIds:[user.sourceId]};
  const store={data:{settings:{model:'model-test',reasoningEffort:'high',serviceTier:null,persona:'自然回答'},paused:false,owner:{userId:'owner-test',botId:'bot-test'},cursor:'private-cursor',threadId:'private-thread',generation:9,history:[user,{id:crypto.randomUUID(),kind:'assistant',text:'记住了',time:user.time,runId:run.id,status:'api_acknowledged',delivery:[{key:'private-key'}]}],runs:[run],auth:'private-auth'},save(){fs.writeFileSync(path.join(root,'assistant.json'),JSON.stringify(this.data));}};
  const vault={redact:s=>String(s).replaceAll('known-secret','[隐藏]')};
  return {features:new ChatFeatures({store,vault,root}),store,user,run,root};
}
function addMemory(f,text='喜欢喝茶',pinned=false){return f.mutateMemory({action:'add',revision:f.data.memory.revision,text,pinned}).entries.at(-1);}
function addSticker(f,note=''){return f.addSticker({revision:f.data.revision,bytes:PNG,mime:'image/png',name:'茶',note});}
function enable(f){f.updateSticker({action:'enable',revision:f.data.revision,enabled:true});}

test('manual memory pin, revision conflict, immutable versions and restore',()=>{
  const {features:f}=fixture(),entry=addMemory(f);
  assert.throws(()=>f.mutateMemory({action:'edit',revision:0,id:entry.id,version:1,text:'咖啡'}),/已更新/);
  f.mutateMemory({action:'edit',revision:1,id:entry.id,version:1,text:'喜欢咖啡',pinned:true});
  assert.equal(f.data.memory.entries[0].versions[0].text,'喜欢喝茶');
  f.mutateMemory({action:'restore',revision:2,id:entry.id,version:2,restoreVersion:1});
  assert.equal(f.data.memory.entries[0].text,'喜欢喝茶');assert.equal(f.data.memory.entries[0].version,3);assert.equal(f.data.memory.entries[0].pinned,false);
});
test('same-call model memory accepts real owner source and rejects invented or quoted source',()=>{
  const {features:f,user}=fixture();
  const op={action:'add',text:'喜欢喝茶',sourceMessageId:user.sourceId};
  const result=f.applyModel({memoryOps:[op,{...op,sourceMessageId:'bot-other/111'},{...op,sourceMessageId:'111'}]},{sourceMessages:[{kind:'user',sourceId:user.sourceId,text:user.text}],memoryContext:f.context(user.text).memory});
  assert.equal(result.memory.applied,1);assert.equal(result.memory.rejected.length,2);assert.equal(f.data.memory.entries[0].source.sourceMessageId,user.sourceId);
  const fake={...user,text:'[引用材料] 我喜欢喝咖啡'};
  assert.equal(f.applyModel({memoryOps:[op]},{sourceMessages:[fake]}).memory.applied,0);
});
test('model cannot alter pinned, unretrieved, stale or disabled memories',()=>{
  const {features:f,user}=fixture(),entry=addMemory(f),pin=addMemory(f,'主人喜欢茶',true),context=f.context('茶').memory;
  f.mutateMemory({action:'edit',revision:2,id:entry.id,version:1,text:'手动修改茶'});
  const result=f.applyModel({memoryOps:[{action:'revise',id:entry.id,version:1,text:'模型覆盖',sourceMessageId:user.sourceId},{action:'disable',id:pin.id,version:1,sourceMessageId:user.sourceId},{action:'disable',id:entry.id,version:2,sourceMessageId:user.sourceId}]},{sourceMessages:[user],memoryContext:context});
  assert.equal(result.memory.applied,0);assert.equal(result.memory.rejected.length,3);assert.equal(f.data.memory.entries[0].text,'手动修改茶');
  f.mutateMemory({action:'toggle',revision:3,enabled:false});assert.equal(f.context('茶').memory.content,'');
  assert.equal(f.applyModel({memoryOps:[{action:'add',text:'新记忆',sourceMessageId:user.sourceId}]},{sourceMessages:[user]}).memory.applied,0);
});
test('model retrieval can revise current unpinned entry and provenance version chain',()=>{
  const {features:f,user}=fixture(),entry=addMemory(f),context=f.context('喝茶').memory;
  const r=f.applyModel({memoryOps:[{action:'revise',id:entry.id,version:entry.version,text:'喜欢绿茶',sourceMessageId:user.sourceId}]},{sourceMessages:[user],memoryContext:context});
  assert.equal(r.memory.applied,1);assert.equal(f.data.memory.entries[0].versions[1].editor,'model');
});
test('feedback must refer to completed real response and supports undo',()=>{
  const {features:f,run}=fixture();assert.throws(()=>f.feedback({action:'add',revision:0,runId:crypto.randomUUID(),rating:'long'}),/已有完成回复/);
  f.feedback({action:'add',revision:0,runId:run.id,rating:'long',note:'短一点'});assert.match(f.context('').feedbackHint,/太长 1/);
  f.feedback({action:'undo',revision:1,id:f.data.feedback[0].id});assert.equal(f.context('').feedbackHint,'');
});
test('role text import, edit and select only change explicit authorized persona',()=>{
  const {features:f}=fixture();f.role({action:'import',revision:0,name:'朋友',text:'有自己的判断'});const r=f.data.roles[0];
  assert.equal(f.context('').persona,null);f.role({action:'select',revision:1,id:r.id});assert.equal(f.context('').persona,'有自己的判断');
  f.role({action:'edit',revision:2,id:r.id,version:1,text:'自然直接'});assert.equal(f.context('').persona,'自然直接');
  assert.throws(()=>f.role({action:'edit',revision:3,id:r.id,version:1,text:'覆盖'}),/已更新/);
});
test('stickers are opt-in own UUID files and enforce MIME signatures and dimensions',()=>{
  const {features:f,root}=fixture(),s=addSticker(f);
  assert.deepEqual(f.context('').stickers,[]);assert.throws(()=>f.loadSticker(s.id),/已禁用/);enable(f);assert.deepEqual(f.loadSticker(s.id).bytes,PNG);
  assert.equal(fs.existsSync(path.join(root,'state','stickers',s.id+'.png')),true);
  assert.throws(()=>f.addSticker({revision:f.data.revision,bytes:PNG,mime:'image/jpeg',name:'错误'}),/不匹配/);
  const huge=Buffer.from(PNG);huge.writeUInt32BE(20000,16);assert.throws(()=>f.addSticker({revision:f.data.revision,bytes:huge,mime:'image/png',name:'过大'}),/不匹配/);
  assert.throws(()=>f.loadSticker('../credentials'),/不存在/);
});
test('sticker learning binds selected version and cannot overwrite manual notes or disabled images',()=>{
  const {features:f}=fixture(),s=addSticker(f);enable(f);const c=f.context('');
  f.updateSticker({action:'edit',revision:f.data.revision,id:s.id,version:1,note:'手动描述'});
  const r=f.applyModel({stickerNotes:[{id:s.id,note:'模型覆盖'}]},{learningIds:c.learningIds});assert.equal(r.stickers.applied,0);assert.equal(f.data.stickers[0].note,'手动描述');
  const s2=addSticker(f),fresh=f.context('');assert.equal(f.applyModel({stickerNotes:[{id:s2.id,note:'茶杯表情'}]},{learningIds:fresh.learningIds}).stickers.applied,1);
  assert.equal(f.data.stickers[1].noteSource,'model');
  f.updateSticker({action:'toggle',revision:f.data.revision,id:s2.id,version:2,enabled:false});assert.throws(()=>f.loadSticker(s2.id),/已禁用/);
});
test('backup whitelist excludes session/auth/media keys and credential URLs; export history is opt-in',()=>{
  const {features:f,store}=fixture();addMemory(f,'喜欢茶 https://example.test/private?key=foo');addSticker(f);
  store.data.settings.persona='自然 known-secret https://example.test?token=abc';store.data.contextTokens={owner:'secret-context'};store.data.inboundMedia={id:{key:'secret-media'}};
  const ordinary=f.exportBackup({});assert.equal(ordinary.sections.history,undefined);
  const full=f.exportBackup({includeHistory:true}),json=JSON.stringify(full);
  for(const value of ['private-cursor','private-thread','private-auth','private-key','secret-context','secret-media','known-secret','api_acknowledged','sourceMessageIds'])assert.equal(json.includes(value),false,value);
  assert.equal(full.sections.stickers[0].base64,PNG.toString('base64'));assert.equal(full.sections.history.length,2);
});
test('restore requires paused quiescent state, retains live binding and operational history; imported history archival',()=>{
  const {features:f,store}=fixture();addMemory(f);const old=addSticker(f);const backup=f.exportBackup({includeHistory:true});
  backup.sections.history[0].status='queued';backup.sections.history[0].contextToken='bad';const p=f.previewBackup(backup,MODELS);
  assert.throws(()=>f.restoreBackup(p.id),/暂停/);store.data.paused=true;const before=structuredClone(store.data);const result=f.restoreBackup(p.id);
  assert.equal(result.ok,true);assert.equal(store.data.owner.userId,before.owner.userId);assert.equal(store.data.cursor,before.cursor);assert.equal(store.data.threadId,before.threadId);assert.equal(store.data.generation,9);assert.deepEqual(store.data.history,before.history);
  assert.equal(store.data.archivedHistory[0].archival,true);assert.equal(store.data.archivedHistory[0].status,undefined);assert.equal(store.data.archivedHistory[0].contextToken,undefined);
  assert.notEqual(f.data.stickers[0].id,old.id);assert.equal(fs.existsSync(path.join(f.root,'state','restore-snapshots',result.snapshot)),true);
});
test('preview rejects malformed backups, unavailable models and mismatched media',()=>{
  const {features:f}=fixture();addSticker(f);const b=f.exportBackup({});
  assert.throws(()=>f.previewBackup({...b,format:'qq-codex-backup'},MODELS),/不支持/);
  const invalid=structuredClone(b);invalid.sections.settings.model='unavailable';assert.throws(()=>f.previewBackup(invalid,MODELS),/不可用/);
  const mismatch=structuredClone(b);mismatch.sections.stickers=[];assert.throws(()=>f.previewBackup(mismatch,MODELS),/不匹配/);
  const unsafe=structuredClone(b);unsafe.sections.features.stickers[0].id='../secret';assert.throws(()=>f.previewBackup(unsafe,MODELS),/编号/);
});
test('preview expires and rejects baseline changes without restoring',()=>{
  const {features:f,store}=fixture(),b=f.exportBackup({});store.data.paused=true;const p=f.previewBackup(b,MODELS);addMemory(f);
  assert.throws(()=>f.restoreBackup(p.id),/已更新/);const p2=f.previewBackup(f.exportBackup({}),MODELS);f.previews.get(p2.id).at-=600001;assert.throws(()=>f.restoreBackup(p2.id),/已过期/);
});
test('store save failures roll back feature updates and restore-created media',()=>{
  const {features:f,store,root}=fixture();const prior=structuredClone(f.data);store.save=()=>{throw new Error('disk failure');};
  assert.throws(()=>addMemory(f),/disk failure/);assert.deepEqual(f.data,prior);assert.throws(()=>addSticker(f),/disk failure/);assert.deepEqual(fs.readdirSync(path.join(root,'state','stickers')),[]);
  store.save=()=>{};addSticker(f);const p=f.previewBackup(f.exportBackup({includeHistory:true}),MODELS);store.data.paused=true;const before=structuredClone(store.data),files=fs.readdirSync(path.join(root,'state','stickers'));store.save=()=>{throw new Error('disk failure');};
  assert.throws(()=>f.restoreBackup(p.id),/disk failure/);assert.deepEqual(store.data,before);assert.deepEqual(fs.readdirSync(path.join(root,'state','stickers')),files);
});

test('backup accepts official model speed catalog and 20000-char persona; preserves image mode',()=>{
  const {features:f,store}=fixture();store.data.settings.serviceTier='fast';store.data.settings.persona='友'.repeat(20000);store.data.settings.imageMode='auto';
  const backup=f.exportBackup({});assert.equal(backup.sections.settings.imageMode,'auto');const p=f.previewBackup(backup,MODELS);store.data.paused=true;f.restoreBackup(p.id);assert.equal(store.data.settings.serviceTier,'fast');assert.equal(store.data.settings.persona.length,20000);assert.equal(store.data.settings.imageMode,'auto');
  const invalid=f.exportBackup({});invalid.sections.settings.serviceTier='invalid-tier';assert.throws(()=>f.previewBackup(invalid,MODELS),/速度档位/);
});
test('disabled sticker preview is permitted only by explicit preview option; query text is never filtered',()=>{
  const {features:f}=fixture(),s=addSticker(f);assert.deepEqual(f.loadSticker(s.id,{forPreview:true}).bytes,PNG);assert.throws(()=>f.loadSticker(s.id),/禁用/);
  assert.doesNotThrow(()=>f.context('如何更换 password=long-secret-value https://example.test'));
});

test('preview retains whitelist baseline only and rejects running restores',()=>{
  const {features:f,store,run}=fixture();store.data.contextTokens={owner:'secret'};store.data.settings.persona='known-secret https://example.test/private';
  const p=f.previewBackup(f.exportBackup({includeHistory:true}),MODELS),saved=JSON.stringify(f.previews.get(p.id));
  for(const excluded of ['known-secret','private-cursor','private-auth','api_acknowledged','contextTokens','inboundMedia'])assert.equal(saved.includes(excluded),false,excluded);
  store.data.paused=true;run.status='preparing';assert.throws(()=>f.restoreBackup(p.id),/当前回复/);
});

test('restore prepareNext participates in one commit and failures restore original media/data',()=>{
  const {features:f,store,root}=fixture();addSticker(f);store.data.paused=true;const b=f.exportBackup({}),p=f.previewBackup(b,MODELS),before=structuredClone(store.data),files=fs.readdirSync(path.join(root,'state','stickers'));
  assert.throws(()=>f.restoreBackup(p.id,{prepareNext:next=>{next.threadId=null;next.generation++;throw new Error('prepare failed');}}),/prepare failed/);
  assert.deepEqual(store.data,before);assert.deepEqual(fs.readdirSync(path.join(root,'state','stickers')),files);
  let saves=0;store.save=()=>{saves++;};f.restoreBackup(p.id,{prepareNext:next=>{next.threadId=null;next.generation++;next.gateEpoch=1;next.paused=true;}});
  assert.equal(saves,1);assert.equal(store.data.threadId,null);assert.equal(store.data.generation,10);assert.equal(store.data.paused,true);
});
test('backup history text is rejected instead of silently truncated',()=>{
  const {features:f,store}=fixture();store.data.history[0].text='字'.repeat(50001);assert.throws(()=>f.exportBackup({includeHistory:true}),/过长/);assert.doesNotThrow(()=>f.exportBackup({includeHistory:false}));
});

test('header-only GIF and WebP cannot enter the local sticker catalog',()=>{
  const {features:f}=fixture();const gif=Buffer.alloc(16);gif.write('GIF89a');gif.writeUInt16LE(1,6);gif.writeUInt16LE(1,8);gif[15]=59;
  assert.throws(()=>f.addSticker({revision:f.data.revision,bytes:gif,mime:'image/gif',name:'无帧'}),/不匹配/);
  const webp=Buffer.alloc(30);webp.write('RIFF');webp.writeUInt32LE(22,4);webp.write('WEBP',8);webp.write('VP8X',12);webp.writeUInt32LE(10,16);
  assert.throws(()=>f.addSticker({revision:f.data.revision,bytes:webp,mime:'image/webp',name:'无帧'}),/不匹配/);
});

test('a complete 1-pixel GIF with data frame is accepted',()=>{
  const {features:f}=fixture();const bytes=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');
  const s=f.addSticker({revision:f.data.revision,bytes,mime:'image/gif',name:'动图'});assert.equal(f.loadSticker(s.id,{forPreview:true}).mime,'image/gif');
});

test('ordinary project URLs preserve q/page/fragments and memory versions through export preview restore',()=>{
  const {features:f,store}=fixture();const url='https://Example.test:8443/docs?q=%E8%8C%B6+guide&page=2&code=sample&state=example#chapter-1';
  const entry=addMemory(f,'资料 '+url);f.mutateMemory({action:'edit',revision:f.data.memory.revision,id:entry.id,version:entry.version,text:'修订资料 '+url});
  f.role({action:'import',revision:f.data.revision,name:'研究助手',text:'参考 '+url});store.data.history[0].text='请看 '+url;
  const backup=f.exportBackup({includeHistory:true});assert.equal(backup.sections.features.memory.entries[0].text,'修订资料 '+url);assert.equal(backup.sections.features.memory.entries[0].versions[0].text,'资料 '+url);assert.equal(backup.sections.features.roles[0].text,'参考 '+url);assert.equal(backup.sections.history[0].text,'请看 '+url);
  const p=f.previewBackup(backup,MODELS);assert.equal(f.previews.get(p.id).baseline.includes(url),true);store.data.paused=true;f.restoreBackup(p.id);
  assert.equal(f.data.memory.entries[0].text,'修订资料 '+url);assert.equal(f.data.memory.entries[0].versions[0].text,'资料 '+url);assert.equal(f.data.roles[0].text,'参考 '+url);assert.equal(store.data.archivedHistory[0].text,'请看 '+url);
});
test('credential URL fields/userinfo redact while ordinary query fields and fragments survive',()=>{
  const {features:f}=fixture();const raw='https://name:private-pass@example.test/docs?q=normal&bot_token=private-bot&access_token=private-access&refresh_token=private-refresh&encrypt_query_param=private-media&aes_key=private-aes&authorization=private-auth&api_key=private-api&page=3#normal-fragment';
  assert.equal(f.clean(raw),'https://example.test/docs?q=normal&page=3#normal-fragment');
  assert.equal(f.clean('https://example.test/?%61ccess_token=private&q=normal#access_token=private-fragment&chapter=2'),'https://example.test/?q=normal#chapter=2');
  assert.equal(f.clean('https://example.test/?q=%6Bnown-secret&page=1').includes('known-secret'),false);assert.equal(f.clean('https://example.test/?q=%6Bnown-secret&page=1').includes('%6Bnown-secret'),false);
});
test('OAuth code/state are removed only on recognized official auth hosts and paths',()=>{
  const {features:f}=fixture();assert.equal(f.clean('https://auth.openai.com/oauth/authorize?client_id=public&code=private-code&state=private-state&q=normal#chapter'),'https://auth.openai.com/oauth/authorize?client_id=public&q=normal#chapter');
  for(const url of ['https://example.test/path?#','https://example.test/?q=normal&&page=2#','https://auth.openai.com.evil.test/oauth/authorize?code=sample&state=normal','https://example.test/oauth/authorize?code=sample&state=normal','https://auth.openai.com/docs?code=sample&state=normal'])assert.equal(f.clean(url),url);
});
test('real credential assignments are scrubbed from history without breaking backup version chains',()=>{
  const {features:f,store}=fixture();store.data.history[0].text='Authorization: Bearer PRIVATE_SECRET_123 password="PRIVATE_PASSWORD_456" api_key=PRIVATE_API_789 资料 https://example.test/?q=normal&page=2#ref';
  const e=addMemory(f,'https://example.test/?q=normal&page=2#ref');f.mutateMemory({action:'edit',revision:1,id:e.id,version:1,text:'继续参考 https://example.test/?q=normal&page=2#ref'});
  const b=f.exportBackup({includeHistory:true}),serialized=JSON.stringify(b);for(const secret of ['PRIVATE_SECRET_123','PRIVATE_PASSWORD_456','PRIVATE_API_789'])assert.equal(serialized.includes(secret),false);
  assert.match(b.sections.history[0].text,/https:\/\/example\.test\/\?q=normal&page=2#ref/);assert.doesNotThrow(()=>f.previewBackup(b,MODELS));
});

test('URL search examples remain exact and URL-shaped credential assignments are removed',()=>{
  const {features:f}=fixture();const query='https://example.test/search?q=password%3Dexample+code&page=2#normal';assert.equal(f.clean(query),query);
  assert.equal(f.clean('password="https://example.test/private-value" 正文'),'password=[已移除] 正文');
  assert.equal(f.clean('api_key=https://example.test/private-value 正文'),'api_key=[已移除] 正文');
});
