import path from 'node:path';
import {spawn} from 'node:child_process';

export function openBrowser({spawnImpl=spawn,timeoutMs=10000}={}) {
  return new Promise((resolve,reject)=>{
    let child,settled=false;
    const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve();};
    const timer=setTimeout(()=>{finish(new Error('打开默认浏览器超时，请在启动页重试或检查系统默认浏览器'));child?.kill();},timeoutMs);
    try {
      child=spawnImpl(path.join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),
        ['-NoLogo','-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; Start-Process -FilePath 'http://127.0.0.1:3130/entry' -ErrorAction Stop"],
        {windowsHide:true,stdio:'ignore'});
      child.once('error',()=>finish(new Error('无法启动默认浏览器，请检查 Windows 浏览器设置')));
      child.once('exit',code=>finish(code===0?null:new Error('打开默认浏览器失败，请检查 Windows 浏览器设置')));
    } catch {finish(new Error('无法启动默认浏览器，请检查 Windows 浏览器设置'));}
  });
}
