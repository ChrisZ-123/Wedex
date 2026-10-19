import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {ROOT,STATE,publicError} from './store.js';

export function protect(action, value) {
  return new Promise((resolve,reject) => {
    const shell=path.join(process.env.SystemRoot ?? 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    const child=spawn(shell,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(ROOT,'scripts','secret-vault.ps1')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    const chunks=[]; let length=0;
    child.stdout.on('data',chunk=>{length+=chunk.length;if(length>4*1024*1024)child.kill();else chunks.push(chunk);});
    child.stderr.resume();
    child.on('error',()=>reject(publicError('Windows DPAPI 不可用，未保存凭据')));
    child.on('exit',code=>code===0?resolve(Buffer.concat(chunks).toString('utf8')):reject(publicError('Windows DPAPI 保护失败，未保存或导出凭据')));
    child.stdin.end(JSON.stringify({action,value}));
  });
}
export class SecretVault {
  constructor(file=path.join(STATE,'credentials.dpapi')) {this.file=file;this.data={};this.queue=Promise.resolve();}
  async load() {
    if(fs.existsSync(this.file))this.data=JSON.parse(await protect('open',fs.readFileSync(this.file,'utf8')));
    if(!this.data.consoleToken){this.data.consoleToken=crypto.randomBytes(32).toString('base64url');await this.save();}
    return this;
  }
  save() {
    const snapshot=JSON.stringify(this.data);
    const task=this.queue.then(async()=>{
      const encrypted=await protect('seal',snapshot);
      fs.mkdirSync(path.dirname(this.file),{recursive:true});
      const temp=`${this.file}.${crypto.randomUUID()}.tmp`;
      try{fs.writeFileSync(temp,encrypted);fs.renameSync(temp,this.file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
    });
    this.queue=task.catch(()=>{});return task;
  }
  redact(text) {
    let result=String(text);
    const values=[this.data.consoleToken,this.data.wechat?.botToken,...Object.values(this.data.contextTokens??{})];
    for(const value of values)if(value)result=result.split(value).join('[凭据已隐藏]');
    return result;
  }
}
