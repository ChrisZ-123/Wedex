// Protocol and media flow adapted from Tencent/openclaw-weixin (MIT), 2.4.10.
// The Tencent attribution and license are included in THIRD_PARTY_NOTICES.md.
import crypto from 'node:crypto';
import {losslessJson,publicError} from './store.js';

export const API_BASE='https://ilinkai.weixin.qq.com';
const CDN_BASE='https://novac2c.cdn.weixin.qq.com/c2c';
const CHANNEL_VERSION='2.4.10';
const APP_VERSION=(2<<16)|(4<<8)|10;
export const MAX_MEDIA_BYTES=25*1024*1024;
export function trustedUrl(raw,kind='api') {
  let url;try{url=new URL(raw);}catch{throw publicError('微信返回的地址无效');}
  const host=url.hostname.toLowerCase();
  const allowed=kind==='api' ? host.endsWith('.weixin.qq.com') : host.endsWith('.cdn.weixin.qq.com');
  if(url.protocol!=='https:'||!allowed||url.username||url.password||url.port)throw publicError('微信返回了不受信任的服务地址，连接已停止');
  return url;
}
export function parseAesKey(value) {
  const bytes=Buffer.from(value,'base64');
  if(bytes.length===16)return bytes;
  const text=bytes.toString('ascii');
  if(/^[\da-f]{32}$/i.test(text))return Buffer.from(text,'hex');
  throw publicError('微信图片密钥格式无效');
}
export function imageMime(bytes) {
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
  if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return 'image/webp';
  if(bytes.subarray(0,6).toString()==='GIF87a'||bytes.subarray(0,6).toString()==='GIF89a')return 'image/gif';
  throw publicError('附件不是受支持的图片');
}
async function boundedBytes(response,max) {
  if(Number(response.headers.get('content-length'))>max)throw publicError('微信响应超过大小限制');
  const chunks=[];let length=0;
  for await(const chunk of response.body){length+=chunk.length;if(length>max){await response.body.cancel().catch(()=>{});throw publicError('微信响应超过大小限制');}chunks.push(chunk);}
  return Buffer.concat(chunks);
}
export class WechatClient {
  constructor({fetchImpl=fetch,connection=()=>null}={}){this.fetch=fetchImpl;this.connection=connection;}
  async request(endpoint,{body={},signed=true,base,method='POST',signal,timeoutMs=15000,metadata=true}={}){
    const connection=this.connection();
    const root=trustedUrl(base??connection?.baseUrl??API_BASE);
    if(signed&&!connection?.botToken)throw publicError('微信尚未绑定');
    const headers={'iLink-App-Id':'bot','iLink-App-ClientVersion':String(APP_VERSION)};
    if(method==='POST'){
      headers['Content-Type']='application/json';headers.AuthorizationType='ilink_bot_token';
      headers['X-WECHAT-UIN']=Buffer.from(String(crypto.randomBytes(4).readUInt32BE())).toString('base64');
      if(signed)headers.Authorization=`Bearer ${connection.botToken}`;
    }
    const data={...body,...(signed&&metadata?{base_info:{channel_version:CHANNEL_VERSION,bot_agent:'WechatCodex/0.1.0'}}:{})};
    let response;
    try{response=await this.fetch(new URL(endpoint,root),{method,headers,...(method==='POST'?{body:JSON.stringify(data)}:{}),redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs)});}
    catch(error){if(signal?.aborted)throw error;const failure=new Error('WeChat network failure');failure.code='NETWORK';throw failure;}
    if(!response.ok){const error=new Error('HTTP failure');error.code='HTTP';error.httpStatus=response.status;throw error;}
    const result=losslessJson((await boundedBytes(response,8*1024*1024)).toString('utf8'));
    const failed=[result.ret,result.errcode].find(value=>value!==undefined&&value!==0);
    if(failed!==undefined){const error=new Error('API failure');error.code=failed===-14?'AUTH_EXPIRED':'API';error.apiCode=failed;throw error;}
    return result;
  }
  qr({signal}={}){const old=this.connection()?.botToken;return this.request('/ilink/bot/get_bot_qrcode?bot_type=3',{signal,signed:false,metadata:false,body:{local_token_list:old?[old]:[]}});}
  qrStatus(qrcode,{base,code,signal}={}) {
    const query=new URLSearchParams({qrcode,...(code?{verify_code:code}:{})});
    return this.request(`/ilink/bot/get_qrcode_status?${query}`,{signed:false,base,method:'GET',signal,timeoutMs:40000});
  }
  updates(cursor,signal,timeoutMs=35000){return this.request('/ilink/bot/getupdates',{body:{get_updates_buf:cursor},signal,timeoutMs:Math.min(Math.max(timeoutMs,35000),120000)+5000});}
  lifecycle(start){return this.request(`/ilink/bot/msg/notify${start?'start':'stop'}`);}
  async typing(userId,contextToken,status=1,{isCurrent=()=>true}={}){
    const config=await this.request('/ilink/bot/getconfig',{body:{ilink_user_id:userId,context_token:contextToken},timeoutMs:10000});
    if(!config.typing_ticket||!isCurrent())return;
    await this.request('/ilink/bot/sendtyping',{body:{ilink_user_id:userId,typing_ticket:config.typing_ticket,status},timeoutMs:10000});
  }
  async send(userId,item,contextToken,{clientId=crypto.randomUUID(),runId,isCurrent=()=>true}={}){
    if(!isCurrent())throw publicError('发送前已停止，未提交微信');
    if(!contextToken)throw publicError('微信缺少当前会话令牌，未尝试发送');
    const result=await this.request('/ilink/bot/sendmessage',{body:{msg:{from_user_id:'',to_user_id:userId,client_id:clientId,message_type:2,message_state:2,context_token:contextToken,item_list:[item],...(runId?{run_id:runId}:{})}}});
    return {clientId,messageId:result.message_id?String(result.message_id):null,acknowledged:true};
  }
  sendText(userId,text,contextToken,options){return this.send(userId,{type:1,text_item:{text}},contextToken,options);}
  async downloadImage(item){
    const image=item.image_item;
    if(!image?.media)throw publicError('微信没有提供可下载的图片');
    const media=image.media;
    const raw=media.full_url??`${CDN_BASE}/download?encrypted_query_param=${encodeURIComponent(media.encrypt_query_param??'')}`;
    const url=trustedUrl(raw,'cdn');
    let response;try{response=await this.fetch(url,{redirect:'error',signal:AbortSignal.timeout(30000)});}catch{const e=new Error('network');e.code='NETWORK';throw e;}
    if(!response.ok){const e=new Error('http');e.code='HTTP';e.httpStatus=response.status;throw e;}
    let bytes=await boundedBytes(response,MAX_MEDIA_BYTES+16);
    const key=image.aeskey?(/^[\da-f]{32}$/i.test(image.aeskey)?Buffer.from(image.aeskey,'hex'):null):media.aes_key?parseAesKey(media.aes_key):null;
    if(image.aeskey&&!key)throw publicError('微信图片密钥无效');
    if(key){try{const decipher=crypto.createDecipheriv('aes-128-ecb',key,null);bytes=Buffer.concat([decipher.update(bytes),decipher.final()]);}catch{throw publicError('微信图片解密失败');}}
    if(bytes.length>MAX_MEDIA_BYTES)throw publicError('图片超过 25 MiB');
    return {bytes,mime:imageMime(bytes)};
  }
  async sendImage(userId,bytes,contextToken,options={}){
    if(!Buffer.isBuffer(bytes)||bytes.length>MAX_MEDIA_BYTES)throw publicError('图片超过发送限制');
    imageMime(bytes);
    const key=crypto.randomBytes(16),aeskey=key.toString('hex'),filekey=crypto.randomUUID();
    const cipher=crypto.createCipheriv('aes-128-ecb',key,null);
    const encrypted=Buffer.concat([cipher.update(bytes),cipher.final()]);
    // MD5 is required by Tencent's upload protocol, not used for identity/dedup.
    if(options.isCurrent&&!options.isCurrent())throw publicError('图片上传前已停止');
    const upload=await this.request('/ilink/bot/getuploadurl',{body:{filekey,media_type:1,to_user_id:userId,rawsize:bytes.length,rawfilemd5:crypto.createHash('md5').update(bytes).digest('hex'),filesize:encrypted.length,no_need_thumb:true,aeskey}});
    const raw=upload.upload_full_url??(upload.upload_param?`${CDN_BASE}/upload?encrypted_query_param=${encodeURIComponent(upload.upload_param)}&filekey=${encodeURIComponent(filekey)}`:null);
    if(!raw)throw publicError('微信未返回图片上传地址');
    if(options.isCurrent&&!options.isCurrent())throw publicError('图片上传前已停止');
    let response;try{response=await this.fetch(trustedUrl(raw,'cdn'),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:encrypted,redirect:'error',signal:AbortSignal.timeout(30000)});}catch{const e=new Error('network');e.code='NETWORK';throw e;}
    const download=response.headers.get('x-encrypted-param');
    if(response.status!==200||!download)throw publicError('微信图片上传未完成，未自动重试');
    return this.send(userId,{type:2,image_item:{media:{encrypt_query_param:download,aes_key:Buffer.from(aeskey).toString('base64'),encrypt_type:1},mid_size:encrypted.length}},contextToken,options);
  }
}
export function normalizeMessage(raw,botId,userId){
  if(raw.message_type!==1||raw.group_id||raw.from_user_id!==userId||raw.message_state===1)return null;
  if(raw.message_id===undefined||raw.message_id===null)throw publicError('微信消息缺少原始消息 ID，未按内容猜测去重');
  const sourceId=`${botId}/${String(raw.message_id)}`;
  const texts=[],images=[],references=[];
  for(const item of raw.item_list??[]){
    if(item.text_item?.text)texts.push(String(item.text_item.text));
    if(item.voice_item)texts.push(item.voice_item.text?`[语音转写] ${item.voice_item.text}`:'[语音暂无转写文字，请改发文字；助手无法听取这段录音]');
    if(item.ref_msg){const ref=item.ref_msg;const text=ref.message_item?.text_item?.text??ref.title;const reference={};if(text)reference.text=String(text);if(ref.svr_id!==undefined&&ref.svr_id!==null)reference.messageId=String(ref.svr_id);if(Object.keys(reference).length)references.push(reference);}
    if(item.image_item)images.push(item);
    if(item.file_item)texts.push(`[文件附件：${item.file_item.file_name??'未命名'}，第一阶段不读取文件内容]`);
    if(item.video_item)texts.push('[视频附件，第一阶段不理解视频内容]');
  }
  return {sourceId,messageId:String(raw.message_id),text:texts.join('\n'),images,references,contextToken:raw.context_token??null};
}
