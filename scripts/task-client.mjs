import path from 'node:path';
import {execFile} from 'node:child_process';
import {ROOT} from '../src/store.js';
export function taskCommand(action,{execFileImpl=execFile}={}) {
 if(!['Install','Start','Status'].includes(action))throw Error('Unsupported task action');
 const exe=path.join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 return new Promise((resolve,reject)=>execFileImpl(exe,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(ROOT,'scripts','Task.ps1'),'-Action',action],
  {windowsHide:true,timeout:15000,maxBuffer:128*1024},(error,stdout)=>{
   if(error){reject(new Error('Windows 独立后台任务操作失败，请检查 Task.ps1 或同名任务权限'));return;}
   try {const value=JSON.parse(stdout.replace(/^\uFEFF/,'').trim());if(value.taskName!=='Wedex-Codex-Assistant'||typeof value.registered!=='boolean')throw Error();resolve(value);}
   catch {reject(new Error('Windows 独立后台任务返回了无效状态'));}
  }));
}
