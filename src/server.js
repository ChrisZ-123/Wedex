import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {ROOT,STATE,PORT,safeError,publicError} from './store.js';
import {SecretVault} from './secrets.js';
import {Assistant} from './assistant.js';

const vault=await new SecretVault().load();
const assistant=new Assistant({vault});
const runtimeStartedAt=new Date().toISOString();
let entryUntil=0;
const origin=`http://127.0.0.1:${PORT}`;
function authorized(request){const supplied=request.headers.authorization??'';const expected=`Bearer ${vault.data.consoleToken}`;const a=Buffer.from(supplied),b=Buffer.from(expected);return a.length===b.length&&crypto.timingSafeEqual(a,b);}
function json(response,status,value){response.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});response.end(JSON.stringify(value));}
async function body(request,maxBytes=128*1024){
  if(!request.headers['content-type']?.startsWith('application/json'))throw publicError('需要 application/json 请求');
  const chunks=[];let size=0;for await(const chunk of request){size+=chunk.length;if(size>maxBytes)throw publicError('请求超过大小限制');chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{throw publicError('请求 JSON 无效');}
}
const server=http.createServer(async(request,response)=>{
  response.setHeader('Cache-Control','no-store');response.setHeader('Referrer-Policy','no-referrer');response.setHeader('X-Content-Type-Options','nosniff');
  response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try{
    if(request.headers.host!==`127.0.0.1:${PORT}`){json(response,403,{error:'仅允许本机地址访问'});return;}
    const url=new URL(request.url,origin);
    if(url.pathname==='/api/instance'&&request.method==='GET'){
      json(response,200,{launchMode:process.env.WECHAT_LAUNCH_MODE==='system-task'?'system-task':'legacy',serverPid:process.pid,supervisorPid:Number(process.env.WECHAT_SUPERVISOR_PID)||null,instanceId:process.env.WECHAT_SUPERVISOR_INSTANCE??null});return;
    }
    if(url.pathname==='/entry'&&request.method==='GET'){
      if(Date.now()>entryUntil){json(response,401,{error:'启动入口已过期，请使用“打开控制台”入口'});return;}
      entryUntil=0;response.writeHead(302,{Location:`/#token=${encodeURIComponent(vault.data.consoleToken)}`});response.end();return;
    }
    const assets={'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/style.css':['style.css','text/css']};
    if(assets[url.pathname]&&request.method==='GET'){
      const [file,type]=assets[url.pathname];response.writeHead(200,{'Content-Type':`${type}; charset=utf-8`});response.end(fs.readFileSync(path.join(ROOT,'public',file)));return;
    }
    if(!url.pathname.startsWith('/api/')){json(response,404,{error:'未找到入口'});return;}
    if(!authorized(request)){json(response,401,{error:'控制台未授权，请从本机启动入口打开'});return;}
    if(request.method==='GET'&&url.pathname==='/api/status'){json(response,200,{...assistant.status(),runtime:{startedAt:runtimeStartedAt,launchMode:process.env.WECHAT_LAUNCH_MODE==='system-task'?'system-task':'legacy',serverPid:process.pid,supervisorPid:Number(process.env.WECHAT_SUPERVISOR_PID)||null,instanceId:process.env.WECHAT_SUPERVISOR_INSTANCE??null,codexPid:assistant.codex.child?.pid??null}});return;}
    if(request.method==='GET'&&url.pathname==='/api/features'){json(response,200,assistant.features.status());return;}
    if(request.method==='GET'&&url.pathname==='/api/history'){json(response,200,assistant.history({offset:Number(url.searchParams.get('offset')??0),limit:Number(url.searchParams.get('limit')??100),q:url.searchParams.get('q')??''}));return;}
    if(request.method==='GET'&&url.pathname==='/api/stickers/image'){const media=assistant.features.loadSticker(url.searchParams.get('id'),{forPreview:true});response.writeHead(200,{'Content-Type':media.mime});response.end(media.bytes);return;}
    if(request.method==='GET'&&url.pathname==='/api/images/image'){const id=url.searchParams.get('id')??'';if(!/^[0-9a-f-]{36}\.(png|jpg|webp)$/i.test(id))throw publicError('图片编号无效');const root=fs.realpathSync(path.join(STATE,'generated'));const file=fs.realpathSync(path.join(root,id));if(!file.startsWith(root+path.sep))throw publicError('图片路径无效');const bytes=fs.readFileSync(file);if(bytes.length>15_000_000)throw publicError('图片超过预览限制');response.writeHead(200,{'Content-Type':id.endsWith('.jpg')?'image/jpeg':id.endsWith('.webp')?'image/webp':'image/png'});response.end(bytes);return;}
    if(request.method!=='POST'){json(response,405,{error:'该接口不支持此方法'});return;}
    if(request.headers.origin!==origin){json(response,403,{error:'请求来源无效'});return;}
    const input=await body(request,url.pathname==='/api/backup/preview'?80*1024*1024:url.pathname==='/api/stickers/add'?8*1024*1024:128*1024);let result={ok:true};
    switch(url.pathname){
      case '/api/codex/login':result=await assistant.codex.login();break;
      case '/api/codex/refresh':await assistant.codex.refresh();assistant.accountChanged();break;
      case '/api/wechat/login':result=await assistant.loginWechat();break;
      case '/api/wechat/verify':assistant.verifyCode(input.code);break;
      case '/api/settings':assistant.saveSettings(input);break;
      case '/api/chat/pause':await assistant.pause(input.paused);break;
      case '/api/chat/stop':await assistant.stop();break;
      case '/api/chat/reset':await assistant.reset();break;
      case '/api/acceptance':assistant.confirmRun(input);break;
      case '/api/acceptance/image':result=await assistant.echoImage(input.imageId);break;
      case '/api/gate':assistant.confirmGate(input);break;
      case '/api/memory':result=assistant.features.mutateMemory(input);break;
      case '/api/feedback':result=assistant.features.feedback(input);break;
      case '/api/role':result=assistant.roleChange(input);break;
      case '/api/stickers/add':{let media;if(input.imageId){media=await assistant.loadImage(input.imageId);}else{if(typeof input.base64!=='string'||input.base64.length>6_666_668||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.base64))throw publicError('表情图片格式或大小无效');media={bytes:Buffer.from(input.base64,'base64'),mime:input.mime};}result=assistant.features.addSticker({...input,...media});break;}
      case '/api/stickers/update':result=assistant.features.updateSticker(input);break;
      case '/api/backup/export':result={data:assistant.features.exportBackup({includeHistory:input.includeHistory??false})};break;
      case '/api/backup/preview':result=assistant.features.previewBackup(input.data,assistant.codex.state.models);break;
      case '/api/backup/restore':result=await assistant.restoreBackup(input.id);break;
      case '/api/console/open':entryUntil=Date.now()+30000;break;
      case '/api/service/stop':setTimeout(()=>void shutdown(),100);break;
      default:json(response,404,{error:'未找到接口'});return;
    }
    json(response,200,result);
  }catch(error){json(response,error.statusCode??(error.publicMessage?400:502),{error:safeError(error)});}
});
server.on('error',()=>{console.error('本机验收服务启动失败，请检查 3130 端口是否被占用');void assistant.close().finally(()=>process.exit(1));});
server.listen(PORT,'127.0.0.1',()=>{
  fs.writeFileSync(path.join(STATE,'server.pid'),String(process.pid));
  assistant.start();console.log(`微信助手验收服务已启动：${origin}。请使用本机“打开控制台”入口。`);
});
let stopping=false;
async function shutdown(){if(stopping)return;stopping=true;await assistant.close();server.close(()=>{const pid=path.join(STATE,'server.pid');if(fs.existsSync(pid)&&fs.readFileSync(pid,'utf8')===String(process.pid))fs.unlinkSync(pid);process.exit(0);});setTimeout(()=>process.exit(0),3000).unref();}
process.on('SIGINT',()=>void shutdown());process.on('SIGTERM',()=>void shutdown());
