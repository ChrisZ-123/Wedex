// Explicit integration probe: runs only the installed official binary, with an empty,
// isolated file credential store. It never requests login or reads another Codex home.
// The empty probe home is retained under ignored test-output for inspection. Windows
// can retain directory handles after process exit; fixture deletion is not an RPC check.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'test-output','installer');fs.mkdirSync(output,{recursive:true});
const home=fs.mkdtempSync(path.join(output,'empty codex home '));
const env={...process.env};
for(const name of Object.keys(env)){
  const normalized=name.toUpperCase();
  if(normalized.startsWith('CODEX_')||normalized.startsWith('QBOT_')||normalized.startsWith('SNOWLUMA_')||['OPENAI_API_KEY','OPENAI_BASE_URL','CHATGPT_TOKEN','WECHAT_CONSOLE_TOKEN'].includes(normalized))delete env[name];
}
env.CODEX_HOME=home;
const child=spawn(path.join(root,'runtime/codex/bin/codex.exe'),['app-server','--stdio','-c','cli_auth_credentials_store="file"','-c','mcp_servers={}','-c','plugins={}'],{cwd:root,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
const closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
let spawnError;
child.once('error',error=>{spawnError=error;});
child.stderr.resume();
let next=0;const pending=new Map();let lines=readline.createInterface({input:child.stdout});
child.stdin.on('error',()=>{});
closed.then(()=>{for(const task of pending.values()){clearTimeout(task.timer);task.reject(spawnError??Error('Probe child closed before completing RPC'));}pending.clear();});
lines.on('line',line=>{let message;try{message=JSON.parse(line);}catch{return}const task=pending.get(message.id);if(!task)return;pending.delete(message.id);clearTimeout(task.timer);message.error?task.reject(Error('RPC error '+message.error.code)):task.resolve(message.result);});
function request(method,params){return new Promise((resolve,reject)=>{const id=++next;const timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timed out'));},30000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');});}
async function waitForClose(timeoutMs){
  let timer;
  try{return await Promise.race([closed,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),timeoutMs);})]);}
  finally{clearTimeout(timer);}
}
let evidence;
try{
  const initialized=await request('initialize',{clientInfo:{name:'wedex_install_probe',version:'0.1.0'},capabilities:{experimentalApi:true}});
  child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
  const account=await request('account/read',{refreshToken:false});
  if(account.account!==null)throw Error('Expected empty probe credential store');
  evidence={initialize:true,initialized:true,accountRead:true,accountPresent:false,platform:process.platform,architecture:os.arch(),userAgent:initialized.userAgent??null,retainedFixture:path.relative(root,home)};
}finally{
  for(const task of pending.values()){clearTimeout(task.timer);task.reject(Error('Probe stopped'));}pending.clear();
  child.stdin.end();
  let completion=await waitForClose(5000);
  if(!completion){
    child.kill();
    completion=await waitForClose(5000);
    lines.close();
    if(!completion)throw Error('Probe child streams did not close after terminating the owned child');
    throw Error('Probe child did not close its streams within 5 seconds of stdin EOF; owned child terminated');
  }
  lines.close();
  if(completion.code!==0)throw Error('Probe child closed unsuccessfully: '+(completion.signal??completion.code));
}
console.log(JSON.stringify({...evidence,childStreamsClosed:true}));
