import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {NativeImages,readNativeImage,MAX_NATIVE_IMAGE_BYTES} from '../src/native-images.js';

const root=path.join(fileURLToPath(new URL('../',import.meta.url)),'test-output','native-images');
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(24)]);
const data='data:image/png;base64,'+png.toString('base64');
const settings={model:'test-model',reasoningEffort:'high',serviceTier:null,persona:'test'};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
class Runtime {
  constructor() { this.ready=Promise.resolve(); this.state={state:'ready',models:[{model:'test-model',supportedReasoningEfforts:[{reasoningEffort:'high'}],inputModalities:['text','image']}]}; this.calls=[]; this.closes=0; }
  async request(method,params) {
    this.calls.push({method,params});
    if(this.hook) { const result=await this.hook(method,params); if(result!==undefined) return result; }
    if(method==='thread/start') return {thread:{id:'image-thread'},model:'test-model'};
    if(method==='turn/start') return {turn:{id:'image-turn'}};
    return {};
  }
  emit(method,params) { this.onNotification?.(method,params); }
  image(result={result:data},turnId='image-turn',threadId='image-thread') { this.emit('item/completed',{threadId,turnId,item:{type:'imageGeneration',status:'completed',...result}}); }
  end(status='completed',turnId='image-turn',threadId='image-thread') { this.emit('turn/completed',{threadId,turn:{id:turnId,status}}); }
  close() { this.closes++; }
}
function fixture(name,options={}) {
  const folder=path.join(root,name),home=path.join(folder,'codex-home'),outputDir=path.join(folder,'generated');
  fs.mkdirSync(path.join(home,'generated_images'),{recursive:true});
  const runtime=new Runtime(),images=new NativeImages({runtime,codexHome:home,outputDir,...options});
  return {runtime,images,home,outputDir,folder};
}

test('native image validates and saves a UUID copy; thread disables fallback and search',async()=>{
  const f=fixture('success');
  const native=path.join(f.home,'generated_images','native.png');fs.writeFileSync(native,png);
  const promise=f.images.generate({prompt:'draw a tree',settings});await tick();
  f.runtime.image({savedPath:native});f.runtime.end();
  const result=await promise;
  assert.deepEqual(result.bytes,png);assert.equal(result.mime,'image/png');assert.deepEqual(fs.readFileSync(result.path),png);
  assert.match(path.basename(result.path),/^[0-9a-f-]{36}\.png$/);
  const params=f.runtime.calls[0].params;assert.equal(params.ephemeral,true);assert.equal(params.allowProviderModelFallback,false);assert.equal(params.config.features.image_generation,true);assert.equal(params.config.web_search,'disabled');assert.deepEqual(params.dynamicTools,[]);
  assert.equal(f.images.status().inFlight,false);f.images.close();assert.equal(f.runtime.closes,0);
});

test('early completed events are replayed only for the actual returned turn',async()=>{
  const f=fixture('early');
  f.runtime.hook=(method)=>{if(method==='turn/start'){f.runtime.image({result:data},'other-turn');f.runtime.end('completed','other-turn');f.runtime.image();f.runtime.end();}};
  assert.equal((await f.images.generate({prompt:'draw',settings})).mime,'image/png');f.images.close();
});

test('unrelated threads and turns cannot complete or supply the result',async()=>{
  const f=fixture('unrelated');const promise=f.images.generate({prompt:'draw',settings});await tick();
  f.runtime.image({},'image-turn','other-thread');f.runtime.end('completed','image-turn','other-thread');f.runtime.image({},'other-turn');f.runtime.end('completed','other-turn');
  assert.equal(f.images.status().inFlight,true);f.runtime.end();await assert.rejects(promise,/未成功返回图片/);f.images.close();
});

test('paths outside generated_images and prefix-neighbor paths are rejected',()=>{
  const f=fixture('paths');const outside=path.join(f.folder,'outside.png');fs.writeFileSync(outside,png);
  assert.throws(()=>readNativeImage({savedPath:outside},f.home),/不在独立/);
  const neighbor=path.join(f.home,'generated_images_other');fs.mkdirSync(neighbor,{recursive:true});const file=path.join(neighbor,'x.png');fs.writeFileSync(file,png);
  assert.throws(()=>readNativeImage({savedPath:file},f.home),/不在独立/);
  assert.throws(()=>readNativeImage({savedPath:'relative.png'},f.home),/路径无效/);f.images.close();
});

test('symlink/junction escaping the real generated root is rejected',()=>{
  const f=fixture('junction');const outside=path.join(f.folder,'outside');fs.mkdirSync(outside,{recursive:true});fs.writeFileSync(path.join(outside,'x.png'),png);
  const link=path.join(f.home,'generated_images','escape');
  if(!fs.existsSync(link)) fs.symlinkSync(outside,link,process.platform==='win32'?'junction':'dir');
  assert.throws(()=>readNativeImage({savedPath:path.join(link,'x.png')},f.home),/不在独立/);f.images.close();
});

test('invalid format, URLs, malformed Base64, MIME mismatch, and oversize files are rejected',()=>{
  const f=fixture('invalid');
  for(const result of ['https://example.invalid/image.png','file:///image.png','@@@@',Buffer.alloc(32).toString('base64'),'data:image/jpeg;base64,'+png.toString('base64')]) assert.throws(()=>readNativeImage({result},f.home));
  const huge=path.join(f.home,'generated_images','huge.png');const fd=fs.openSync(huge,'w');fs.ftruncateSync(fd,MAX_NATIVE_IMAGE_BYTES+1);fs.closeSync(fd);
  assert.throws(()=>readNativeImage({savedPath:huge},f.home),/大小无效/);f.images.close();
});

test('edit references must be usable supported data URLs and are forwarded exactly',async()=>{
  const f=fixture('references');
  await assert.rejects(f.images.generate({prompt:'edit',settings,sourceImages:[{url:'https://example.invalid/ref.png'}]}),/参考图不可用/);assert.equal(f.runtime.calls.length,0);
  const promise=f.images.generate({prompt:'edit',settings,sourceImages:[{url:data}]});await tick();
  assert.deepEqual(f.runtime.calls.find(x=>x.method==='turn/start').params.input[1],{type:'image',url:data});f.runtime.image();f.runtime.end();await promise;f.images.close();
});

test('single job, cancellation interrupts exact turn and holds slot until native end',async()=>{
  const f=fixture('cancel');const promise=f.images.generate({prompt:'draw',settings});await tick();
  await assert.rejects(f.images.generate({prompt:'another',settings}),/仍在处理中/);
  const rejected=assert.rejects(promise,/已取消/);await f.images.cancel();await rejected;
  assert.deepEqual(f.runtime.calls.find(x=>x.method==='turn/interrupt').params,{threadId:'image-thread',turnId:'image-turn'});
  assert.equal(f.images.status().inFlight,true);f.runtime.image();f.runtime.end();assert.equal(f.images.status().inFlight,false);assert.equal(fs.existsSync(f.outputDir),false);f.images.close();
});

test('timeout poisons slot, rejects promptly, discards late images until native end',async()=>{
  const f=fixture('timeout',{timeoutMs:10});const promise=f.images.generate({prompt:'draw',settings});
  await assert.rejects(promise,/超时/);assert.equal(f.images.status().uncertain,true);assert.equal(f.images.status().available,false);
  await assert.rejects(f.images.generate({prompt:'again',settings}),/状态未确认/);
  f.runtime.image();f.runtime.end();assert.equal(f.images.status().inFlight,false);assert.equal(fs.existsSync(f.outputDir),false);f.images.close();
});

test('RPC failure keeps uncertain slot and does not resubmit',async()=>{
  const f=fixture('rpc-failure');f.runtime.hook=(method)=>{if(method==='turn/start')throw new Error('private backend details');};
  await assert.rejects(f.images.generate({prompt:'draw',settings}),/状态未确认/);assert.equal(f.images.status().uncertain,true);assert.equal(f.images.status().available,false);assert.equal(f.runtime.calls.filter(x=>x.method==='turn/start').length,1);assert.doesNotMatch(JSON.stringify(f.images.status()),/private backend/);f.images.close();
});

test('cancellation while turn/start is pending rejects immediately then interrupts known turn',async()=>{
  const f=fixture('pending');let finish;f.runtime.hook=(method)=>method==='turn/start'?new Promise(resolve=>{finish=resolve;}):undefined;
  const promise=f.images.generate({prompt:'draw',settings});await tick();const rejection=assert.rejects(promise,/已取消/);await f.images.cancel();await rejection;assert.equal(f.images.status().inFlight,true);
  finish({turn:{id:'image-turn'}});await tick();assert.equal(f.runtime.calls.filter(x=>x.method==='turn/interrupt').length,1);f.runtime.end('interrupted');assert.equal(f.images.status().inFlight,false);f.images.close();
});

test('final isCurrent guard and status callback cancellation prevent result delivery',async()=>{
  const f=fixture('guard');let current=true;const promise=f.images.generate({prompt:'draw',settings,isCurrent:()=>current});await tick();current=false;f.runtime.image();f.runtime.end();await assert.rejects(promise,/已取消/);assert.equal(fs.existsSync(f.outputDir),false);f.images.close();
  const g=fixture('callback');const pending=g.images.generate({prompt:'draw',settings,onStatus:status=>{if(status==='completed')void g.images.cancel();}});await tick();g.runtime.image();g.runtime.end();await assert.rejects(pending,/已取消/);assert.deepEqual(fs.readdirSync(g.outputDir),[]);g.images.close();
});

test('failed tool result, empty turn and failed turn return explicit errors',async()=>{
  for(const name of ['tool','empty','turn']) {
    const f=fixture('failure-'+name),promise=f.images.generate({prompt:'draw',settings});await tick();
    if(name==='tool')f.runtime.image({failure:{type:'failed'}});if(name==='turn')f.runtime.image();f.runtime.end(name==='turn'?'failed':'completed');
    await assert.rejects(promise,/未成功返回图片/);assert.equal(f.images.status().inFlight,false);f.images.close();
  }
});

test('close restores injected callback and never kills the borrowed process',async()=>{
  const runtime=new Runtime();let count=0;const previous=()=>count++;runtime.onNotification=previous;
  const images=new NativeImages({runtime});runtime.emit('unrelated',{});assert.equal(count,1);images.close();assert.equal(runtime.onNotification,previous);assert.equal(runtime.closes,0);await assert.rejects(images.generate({prompt:'draw',settings}),/已关闭/);
});

test('timeout during runtime readiness never submits an image and holds the slot',async()=>{
  const f=fixture('ready-timeout',{timeoutMs:10});let ready;f.runtime.ready=new Promise(resolve=>{ready=resolve;});
  await assert.rejects(f.images.generate({prompt:'draw',settings}),/超时/);ready();await tick();assert.equal(f.runtime.calls.length,0);assert.equal(f.images.status().available,false);f.images.close();
});

test('invalid current account settings fail before any RPC and release the slot',async()=>{
  const f=fixture('settings');await assert.rejects(f.images.generate({prompt:'draw',settings:{...settings,model:'other'}}),/未自动更换/);assert.equal(f.runtime.calls.length,0);assert.equal(f.images.status().available,true);f.images.close();
});

test('stored generated references require known UUID metadata, local containment, size and magic',async()=>{
  const {readGeneratedImage}=await import('../src/native-images.js');const f=fixture('generated-reader');fs.mkdirSync(f.outputDir,{recursive:true});
  const id='00000000-0000-4000-8000-000000000001.png';fs.writeFileSync(path.join(f.outputDir,id),png);assert.deepEqual(readGeneratedImage({id,mime:'image/png'},f.outputDir).bytes,png);
  for(const metadata of [{id:'../outside.png',mime:'image/png'},{id:'https://example.invalid/x.png',mime:'image/png'},{id,mime:'image/jpeg'}])assert.throws(()=>readGeneratedImage(metadata,f.outputDir));
  const invalid='00000000-0000-4000-8000-000000000002.png';fs.writeFileSync(path.join(f.outputDir,invalid),Buffer.alloc(32));assert.throws(()=>readGeneratedImage({id:invalid,mime:'image/png'},f.outputDir),/不是支持的/);
  const outside=path.join(f.folder,'outside-generated');fs.mkdirSync(outside,{recursive:true});fs.writeFileSync(path.join(outside,id),png);const escaped='00000000-0000-4000-8000-000000000003.png';
  // Windows file symlinks require host privileges; model their realpath result without changing privileges.
  if(process.platform==='win32'){const realpath=fs.realpathSync;fs.realpathSync=file=>file===path.join(f.outputDir,escaped)?realpath(path.join(outside,id)):realpath(file);try{assert.throws(()=>readGeneratedImage({id:escaped,mime:'image/png'},f.outputDir),/路径不在独立/);}finally{fs.realpathSync=realpath;}}
  else{if(!fs.existsSync(path.join(f.outputDir,escaped)))fs.symlinkSync(path.join(outside,id),path.join(f.outputDir,escaped),'file');assert.throws(()=>readGeneratedImage({id:escaped,mime:'image/png'},f.outputDir),/路径不在独立/);}
  f.images.close();
});
