import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {ROOT,atomicJson} from './store.js';

export const SUPERVISOR_PIPE = '\\\\.\\pipe\\Wedex-Codex-Assistant';

// This pipe is a local mutex only. It accepts no control commands or data.
export async function runSupervisor({
  root=ROOT,
  socketPath=SUPERVISOR_PIPE,
  spawnImpl=spawn,
  signalSource=process,
  childArgs=[path.join(root,'src','server.js')],
  report=message=>console.error(message),
}={}) {
  const mutex=net.createServer(socket=>socket.destroy());
  let locked=false, logFd, child, stopRequested, failure, childClosed=false;
  const instanceId=crypto.randomUUID();
  const metadata={pid:process.pid,serverPid:null,instanceId,startedAt:new Date().toISOString(),state:'starting'};
  const stateFile=path.join(root,'state','supervisor.json');
  const save=()=>atomicJson(stateFile,metadata);
  const stopOwnedChild=signal=>{
    if(stopRequested || childClosed)return;
    stopRequested=signal;
    if(child?.pid) {
      try { child.kill('SIGTERM'); }
      catch { failure??='无法终止本次启动的服务子进程'; report(failure); }
    }
  };
  const onSigint=()=>stopOwnedChild('SIGINT');
  const onSigterm=()=>stopOwnedChild('SIGTERM');
  const onMutexError=()=>{
    failure='后台监督器的本机互斥管道异常';
    report(failure);
    stopOwnedChild('mutex-error');
  };
  try {
    try {
      await new Promise((resolve,reject)=>{
        mutex.once('error',reject);
        mutex.listen({path:socketPath,exclusive:true},()=>{
          mutex.removeListener('error',reject);
          locked=true;
          resolve();
        });
      });
    } catch(error) {
      report(error.code==='EADDRINUSE'?'后台监督器已经运行，本次未启动服务':'后台监督器无法取得本机互斥管道');
      return error.code==='EADDRINUSE'?2:1;
    }
    mutex.on('error',onMutexError);
    save();
    fs.mkdirSync(path.join(root,'logs'),{recursive:true});
    logFd=fs.openSync(path.join(root,'logs','service.log'),'a');
    signalSource.on('SIGINT',onSigint);
    signalSource.on('SIGTERM',onSigterm);
    const outcome=await new Promise(resolve=>{
      const finish=(code,signal)=>{
        if(childClosed)return;
        childClosed=true;
        child?.removeListener('spawn',onSpawn);
        child?.removeListener('error',onError);
        child?.removeListener('close',finish);
        resolve({code,signal});
      };
      const onError=()=>{
        failure='服务子进程启动失败';
        report(failure);
        if(child?.pid)stopOwnedChild('child-error');
        else finish(1,null);
      };
      const onSpawn=()=>{
        metadata.serverPid=child.pid;
        metadata.state='running';
        try { save(); }
        catch {
          failure='后台监督器运行状态写入失败';
          report(failure);
          stopOwnedChild('state-error');
        }
        if(stopRequested && !child.killed) {
          try { child.kill('SIGTERM'); }
          catch { failure='无法终止本次启动的服务子进程'; report(failure); }
        }
      };
      try {
        child=spawnImpl(process.execPath,childArgs,{
          cwd:root,
          env:{...process.env,WECHAT_LAUNCH_MODE:'system-task',WECHAT_SUPERVISOR_PID:String(process.pid),WECHAT_SUPERVISOR_INSTANCE:instanceId},
          stdio:['ignore',logFd,logFd],
          windowsHide:true,
          detached:false,
        });
        child.once('spawn',onSpawn);
        child.on('error',onError);
        child.once('close',finish);
      } catch { onError(); }
    });
    const requested=stopRequested==='SIGINT'||stopRequested==='SIGTERM';
    const exitCode=failure?1:requested?(stopRequested==='SIGINT'?130:143):Number.isInteger(outcome.code)?outcome.code:1;
    metadata.state=(!failure && (requested || outcome.code===0))?'stopped':'failed';
    metadata.exitCode=exitCode;
    metadata.finishedAt=new Date().toISOString();
    save();
    if(metadata.state==='failed' && !failure)report(outcome.signal?'服务子进程被信号终止，未自动重启':`服务子进程异常退出（${exitCode}），未自动重启`);
    return exitCode;
  } catch {
    report('后台监督器初始化或状态保存失败');
    if(locked && !child?.pid) {
      metadata.state='failed';
      metadata.exitCode=1;
      metadata.finishedAt=new Date().toISOString();
      try { save(); } catch { /* The original filesystem failure is already reported. */ }
    }
    return 1;
  } finally {
    signalSource.removeListener('SIGINT',onSigint);
    signalSource.removeListener('SIGTERM',onSigterm);
    mutex.removeListener('error',onMutexError);
    if(locked)await new Promise(resolve=>mutex.close(resolve));
    if(logFd!==undefined)fs.closeSync(logFd);
  }
}
