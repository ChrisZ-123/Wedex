import fs from 'node:fs';
import path from 'node:path';
import {taskCommand} from './task-client.mjs';
import {startManaged,stopManaged} from './background-control.mjs';
import {openBrowser} from './browser.mjs';
import {assertPortAvailable} from './port.mjs';
import {createControlApi} from './control-api.mjs';
import {SecretVault} from '../src/secrets.js';
import {ROOT,STATE,PORT} from '../src/store.js';

const action=process.argv[2]??'Status';
if(!['Start','Stop','Status','PrepareConsole','OpenConsole'].includes(action))throw Error('Unsupported control action');
const vault=await new SecretVault().load();
const origin='http://127.0.0.1:'+PORT;
const api=createControlApi({origin,token:vault.data.consoleToken,readMetadata:metadata});
async function status(){try{return await api('/api/status');}catch{return null;}}
function metadata(){try{return JSON.parse(fs.readFileSync(path.join(STATE,'supervisor.json'),'utf8'));}catch{return null;}}
async function start(){if(!await status())await assertPortAvailable(PORT);return startManaged({readStatus:status,readMetadata:metadata,runTask:taskCommand});}
async function stop(){return stopManaged({readStatus:status,readMetadata:metadata,requestStop:()=>api('/api/service/stop',{})});}

async function open(){
  await api('/api/console/open',{});
  await openBrowser();
}
if(action==='Start'){await start();console.log('微信助手独立后台已启动');}
if(action==='Stop'){if(await stop())console.log('本部署微信助手已停止');else console.log('微信助手未运行');}
if(action==='Status'){const s=await status();console.log(s?JSON.stringify({stage:s.stage,wechat:s.wechat.state,codex:s.codex.state,gateConfirmed:s.gate.confirmed,pending:s.chat.pending,running:Boolean(s.chat.running),modelCount:s.codex.models.length,loginWaiting:Boolean(s.codex.login?.authUrl),runtime:s.runtime??null}):'微信助手未运行');}
if(action==='PrepareConsole'){await api('/api/console/open',{});console.log('本机一次性控制台入口已准备（30 秒内有效）');}
if(action==='OpenConsole'){await start();await open();console.log('助手已就绪；已向默认浏览器提交控制台打开请求。');}
