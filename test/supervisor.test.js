import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import {EventEmitter} from 'node:events';
import {runSupervisor,SUPERVISOR_PIPE} from '../src/supervisor.js';
import {ROOT} from '../src/store.js';

const outputs=path.join(ROOT,'test-output','supervisor');
function fixture(t) {
  fs.mkdirSync(outputs,{recursive:true});
  const root=fs.mkdtempSync(path.join(outputs,'case-'));
  assert.ok(path.resolve(root).startsWith(path.resolve(outputs)+path.sep));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const socketPath=process.platform==='win32'? `\\\\.\\pipe\\Wedex-Supervisor-Test-${crypto.randomUUID()}`:path.join(root,'mutex.sock');
  const signalSource=new EventEmitter(), reports=[];
  return {root,socketPath,signalSource,reports,report:message=>reports.push(message)};
}
const metadata=f=>JSON.parse(fs.readFileSync(path.join(f.root,'state','supervisor.json'),'utf8'));
async function until(condition) {
  const deadline=Date.now()+5000;
  while(!condition()) {
    if(Date.now()>deadline)throw new Error('fixture wait exceeded 5 seconds');
    await new Promise(resolve=>setTimeout(resolve,10));
  }
}
function fakeChild(run) {
  const child=new EventEmitter();child.pid=123456;child.killed=false;
  child.kill=signal=>{child.killed=true;child.killSignal=signal;queueMicrotask(()=>child.emit('close',null,signal));return true;};
  return {child,spawnImpl:(exe,args,options)=>{
    child.command={exe,args,options};
    queueMicrotask(()=>{child.emit('spawn');run?.(child);});
    return child;
  }};
}

test('default mutex is the scoped Wedex pipe',()=>{
  assert.equal(SUPERVISOR_PIPE,'\\\\.\\pipe\\Wedex-Codex-Assistant');
});

test('real fixture child receives supervisor identity and appends logs until exit',async t=>{
  const f=fixture(t);
  fs.mkdirSync(path.join(f.root,'logs'),{recursive:true});
  fs.writeFileSync(path.join(f.root,'logs','service.log'),'previous-log\n');
  const childCode="console.log(JSON.stringify({mode:process.env.WECHAT_LAUNCH_MODE,pid:process.env.WECHAT_SUPERVISOR_PID,instance:process.env.WECHAT_SUPERVISOR_INSTANCE}));console.error('fixture-error-log');setTimeout(()=>process.exit(0),40)";
  assert.equal(await runSupervisor({...f,childArgs:['-e',childCode]}),0);
  const state=metadata(f);
  assert.equal(state.state,'stopped');assert.equal(state.pid,process.pid);assert.ok(state.serverPid>0);
  assert.equal(state.exitCode,0);assert.ok(Date.parse(state.startedAt));assert.ok(Date.parse(state.finishedAt));
  const lines=fs.readFileSync(path.join(f.root,'logs','service.log'),'utf8').trim().split(/\r?\n/);
  assert.equal(lines[0],'previous-log');
  const inherited=JSON.parse(lines[1]);
  assert.deepEqual(inherited,{mode:'system-task',pid:String(process.pid),instance:state.instanceId});
  assert.equal(lines[2],'fixture-error-log');
  assert.deepEqual(Object.keys(state).sort(),['pid','serverPid','instanceId','startedAt','state','exitCode','finishedAt'].sort());
  assert.equal(f.signalSource.listenerCount('SIGINT'),0);assert.equal(f.signalSource.listenerCount('SIGTERM'),0);
});

test('nonzero child exit is recorded once without respawning',async t=>{
  const f=fixture(t);let starts=0;
  const fake=fakeChild(child=>child.emit('close',7,null));
  assert.equal(await runSupervisor({...f,spawnImpl:(...args)=>{starts++;return fake.spawnImpl(...args);}}),7);
  assert.equal(starts,1);assert.equal(metadata(f).state,'failed');assert.equal(metadata(f).exitCode,7);
  assert.match(f.reports.join(' '),/异常退出/);
  assert.equal(fake.child.command.exe,process.execPath);
  assert.deepEqual(fake.child.command.args,[path.join(f.root,'src','server.js')]);
  assert.deepEqual(fake.child.command.options.stdio.slice(0,1),['ignore']);
  assert.equal(fake.child.command.options.stdio[1],fake.child.command.options.stdio[2]);
  assert.equal(fake.child.command.options.windowsHide,true);
  assert.equal(fake.child.command.options.detached,false);
  assert.throws(()=>fs.fstatSync(fake.child.command.options.stdio[1]),{code:'EBADF'});
  assert.equal(fake.child.command.options.env.WECHAT_CODEX_EXE,process.env.WECHAT_CODEX_EXE);
});

test('unexpected child signal is an explicit failure',async t=>{
  const f=fixture(t),fake=fakeChild(child=>child.emit('close',null,'SIGKILL'));
  assert.equal(await runSupervisor({...f,spawnImpl:fake.spawnImpl}),1);
  assert.equal(metadata(f).state,'failed');assert.match(f.reports.join(' '),/信号终止/);
});

test('exclusive real mutex rejects parallel launch and accepts no commands',async t=>{
  const f=fixture(t);
  const first=runSupervisor({...f,childArgs:['-e',"setInterval(()=>{},1000)"]});
  t.after(()=>f.signalSource.emit('SIGTERM'));
  await until(()=>fs.existsSync(path.join(f.root,'state','supervisor.json'))&&metadata(f).state==='running');
  const second=fixture(t);let starts=0;
  assert.equal(await runSupervisor({...second,socketPath:f.socketPath,spawnImpl:()=>{starts++;throw new Error('must not spawn');}}),2);
  assert.equal(starts,0);assert.equal(fs.existsSync(path.join(second.root,'state','supervisor.json')),false);
  assert.match(second.reports[0],/已经运行/);
  await new Promise((resolve,reject)=>{
    const client=net.connect(f.socketPath);
    client.on('error',reject);client.once('close',resolve);
    client.once('connect',()=>client.write('stop-or-start-command'));
  });
  assert.equal(metadata(f).state,'running');
  f.signalSource.emit('SIGTERM');assert.equal(await first,143);
  assert.equal(metadata(f).state,'stopped');
  assert.equal(f.signalSource.listenerCount('SIGTERM'),0);
  const next=fakeChild(child=>child.emit('close',0,null));
  assert.equal(await runSupervisor({...f,spawnImpl:next.spawnImpl}),0);
});

for(const [signal,code] of [['SIGINT',130],['SIGTERM',143]]) {
  test(`${signal} stops only the owned child and removes listeners`,async t=>{
    const f=fixture(t),fake=fakeChild();
    const pending=runSupervisor({...f,spawnImpl:fake.spawnImpl});
    await until(()=>fs.existsSync(path.join(f.root,'state','supervisor.json'))&&metadata(f).state==='running');
    f.signalSource.emit(signal);f.signalSource.emit(signal);
    assert.equal(await pending,code);
    assert.equal(fake.child.killed,true);assert.equal(fake.child.killSignal,'SIGTERM');
    assert.equal(metadata(f).state,'stopped');assert.equal(metadata(f).exitCode,code);
    assert.equal(f.signalSource.listenerCount('SIGINT'),0);assert.equal(f.signalSource.listenerCount('SIGTERM'),0);
  });
}

test('spawn error records failure, releases mutex, and never claims running',async t=>{
  const f=fixture(t),child=new EventEmitter();
  assert.equal(await runSupervisor({...f,spawnImpl:()=>{queueMicrotask(()=>{child.emit('error',new Error('private fixture detail'));child.emit('close',-2,null);});return child;}}),1);
  assert.equal(metadata(f).state,'failed');assert.equal(metadata(f).serverPid,null);
  assert.ok(!f.reports.join(' ').includes('private fixture detail'));
  const next=fakeChild(c=>c.emit('close',0,null));
  assert.equal(await runSupervisor({...f,spawnImpl:next.spawnImpl}),0);
});

test('synchronous spawn failure releases resources and marks failed',async t=>{
  const f=fixture(t);
  assert.equal(await runSupervisor({...f,spawnImpl:()=>{throw new Error('fixture');}}),1);
  assert.equal(metadata(f).state,'failed');
  assert.equal(f.signalSource.listenerCount('SIGINT'),0);
  const next=fakeChild(c=>c.emit('close',0,null));
  assert.equal(await runSupervisor({...f,spawnImpl:next.spawnImpl}),0);
});

test('log initialization failure never spawns and releases mutex',async t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.root,'logs'),'fixture blocker');let starts=0;
  assert.equal(await runSupervisor({...f,spawnImpl:()=>{starts++;}}),1);
  assert.equal(starts,0);assert.equal(metadata(f).state,'failed');
  fs.unlinkSync(path.join(f.root,'logs'));
  const next=fakeChild(c=>c.emit('close',0,null));
  assert.equal(await runSupervisor({...f,spawnImpl:next.spawnImpl}),0);
});

test('running metadata failure terminates its child and releases mutex',async t=>{
  const f=fixture(t),fake=fakeChild();
  const pending=runSupervisor({...f,spawnImpl:(...args)=>{
    fs.unlinkSync(path.join(f.root,'state','supervisor.json'));
    fs.mkdirSync(path.join(f.root,'state','supervisor.json'));
    return fake.spawnImpl(...args);
  }});
  assert.equal(await pending,1);assert.equal(fake.child.killed,true);
  assert.match(f.reports.join(' '),/状态写入失败/);
  fs.rmdirSync(path.join(f.root,'state','supervisor.json'));
  const next=fakeChild(c=>c.emit('close',0,null));
  assert.equal(await runSupervisor({...f,spawnImpl:next.spawnImpl}),0);
});

test('other mutex errors are explicit and do not spawn or change state',async t=>{
  const f=fixture(t);let starts=0;
  assert.equal(await runSupervisor({...f,socketPath:null,spawnImpl:()=>{starts++;}}),1);
  assert.equal(starts,0);assert.equal(fs.existsSync(path.join(f.root,'state','supervisor.json')),false);
  assert.match(f.reports[0],/无法取得/);
});

test('signal received while spawning still terminates the subsequently owned child',async t=>{
  const f=fixture(t),fake=fakeChild();
  assert.equal(await runSupervisor({...f,spawnImpl:(...args)=>{
    f.signalSource.emit('SIGTERM');
    return fake.spawnImpl(...args);
  }}),143);
  assert.equal(fake.child.killed,true);assert.equal(metadata(f).state,'stopped');
  assert.equal(f.signalSource.listenerCount('SIGTERM'),0);
  assert.throws(()=>fs.fstatSync(fake.child.command.options.stdio[1]),{code:'EBADF'});
});