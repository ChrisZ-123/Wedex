import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {openBrowser} from '../scripts/browser.mjs';

function fake(run) {
  const child=new EventEmitter(); child.kill=()=>{child.killed=true;};
  return {child,spawnImpl:(exe,args,options)=>{child.command={exe,args,options};queueMicrotask(()=>run(child));return child;}};
}
test('browser dispatch waits for the opener to exit successfully',async()=>{
  const f=fake(()=>{});let done=false;const pending=Promise.resolve(openBrowser({spawnImpl:f.spawnImpl})).then(()=>{done=true;});
  await new Promise(r=>setImmediate(r));assert.equal(done,false);
  assert.equal(f.child.command.options.windowsHide,true);
  assert.equal(f.child.command.args.join(' ').includes('http://127.0.0.1:3130/entry'),true);
  assert.equal(f.child.command.args.join(' ').includes('Bearer'),false);
  f.child.emit('exit',0);await pending;assert.equal(done,true);
});
test('browser spawn failure is reported instead of claiming it opened',async()=>{
  const f=fake(child=>child.emit('error',new Error('fixture failure')));await assert.rejects(openBrowser({spawnImpl:f.spawnImpl}),/默认浏览器/);
});
test('browser nonzero exit is reported',async()=>{
  const f=fake(child=>child.emit('exit',1));await assert.rejects(openBrowser({spawnImpl:f.spawnImpl}),/默认浏览器/);
});
test('browser opener timeout fails once and terminates only the owned helper',async()=>{
  const f=fake(()=>{});await assert.rejects(openBrowser({spawnImpl:f.spawnImpl,timeoutMs:15}),/超时/);assert.equal(f.child.killed,true);
});
