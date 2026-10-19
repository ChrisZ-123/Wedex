import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {ROOT, publicError, atomicJson} from './store.js';
import {validateSettings} from './codex.js';

const clone = value => structuredClone(value);
const now = () => new Date().toISOString();
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw publicError(message); };
const conflict = () => { const error = publicError('数据已更新，请刷新后重试'); error.statusCode = 409; throw error; };
const integer = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
const secret = /\bsk-[A-Za-z0-9_-]{16,}|(?:api[_ -]?key|access[_ -]?token|authorization|password|密码|访问令牌)\s*[:=：]\s*\S{6,}/i;
function text(value, max, required = true) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()) || /\u0000/.test(value) || secret.test(value)) fail('文本为空、过长或疑似包含凭据');
  return value.trim();
}
function backupSize(value) { if(Buffer.byteLength(JSON.stringify(value),'utf8')>75_000_000)fail('备份文件最大 75 MB，请取消包含历史或减少数据');return value; }
function bool(value) { if (typeof value !== 'boolean') fail('开关格式无效'); return value; }
function bounded(value, max) { if (!Array.isArray(value) || value.length > max) fail('记录数量超出限制'); return value; }
function defaults() { return {version:1,revision:0,memory:{enabled:true,revision:0,entries:[]},feedback:[],roles:[],selectedRoleId:null,stickersEnabled:false,stickers:[]}; }
function source(value) {
  if (!object(value) || !['manual','model','restore'].includes(value.type)) fail('来源无效');
  return {type:value.type,...(value.sourceMessageId ? {sourceMessageId:text(value.sourceMessageId,250)} : {}),at:text(value.at,50)};
}
function memoryVersion(entry) { return {version:entry.version,text:entry.text,pinned:entry.pinned,enabled:entry.enabled,source:clone(entry.source),editor:entry.editor,at:entry.at}; }
function memorySize(memory) { if(memory.entries.reduce((n,e)=>n+e.text.length+e.versions.reduce((v,h)=>v+h.text.length,0),0)>2_000_000)fail('记忆及修订文本合计最多 2000000 字符');if (memory.entries.filter(e => e.enabled).reduce((n,e) => n + e.text.length,0) > 30000) fail('有效记忆最多 30000 字符'); }
const words = value => [...new Intl.Segmenter('zh',{granularity:'word'}).segment(value.toLowerCase())].filter(w => w.isWordLike).map(w => w.segment);
const EXT = {'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'};
function dimensions(w,h) { return w>0 && h>0 && w<=10000 && h<=10000 && w*h<=40_000_000; }
function pngChunks(b) {
  let offset=8,hasData=false;
  while(offset+12<=b.length){const length=b.readUInt32BE(offset),type=b.toString('ascii',offset+4,offset+8);if(length>b.length-offset-12)return false;if(type==='IDAT'&&length)hasData=true;offset+=length+12;if(type==='IEND')return length===0&&hasData&&offset===b.length;}
  return false;
}
function jpegFrame(b) {
  if(b[0]!==255||b[1]!==216||b[b.length-2]!==255||b[b.length-1]!==217)return false;
  let offset=2,frame=false;
  while(offset+4<=b.length){if(b[offset++]!==255)return false;while(b[offset]===255)offset++;const marker=b[offset++];if(marker===218)return frame;if(marker===0||marker===217)return false;if(marker===1||(marker>=208&&marker<=215))continue;if(offset+2>b.length)return false;const len=b.readUInt16BE(offset);if(len<2||len>b.length-offset)return false;
    if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){if(len<8)return false;frame=dimensions(b.readUInt16BE(offset+5),b.readUInt16BE(offset+3));if(!frame)return false;}offset+=len;
  }return false;
}
function webpImage(b,offset,length,type) {
  if(type==='VP8L'&&length>=6&&b[offset]===47){const bits=b.readUInt32LE(offset+1);return (bits>>>29)===0&&dimensions(1+(bits&16383),1+((bits>>>14)&16383));}
  if(type==='VP8 '&&length>10&&(b[offset]&1)===0&&b[offset+3]===157&&b[offset+4]===1&&b[offset+5]===42)return dimensions(b.readUInt16LE(offset+6)&16383,b.readUInt16LE(offset+8)&16383);
  return false;
}
function webpFrame(b) {
  let offset=12,frame=false;
  while(offset+8<=b.length){const type=b.toString('ascii',offset,offset+4),length=b.readUInt32LE(offset+4),data=offset+8;if(length>b.length-data)return false;
    if(type==='VP8X' && (length!==10||!dimensions(1+b.readUIntLE(data+4,3),1+b.readUIntLE(data+7,3))))return false;
    if(type==='VP8 '||type==='VP8L'){if(!webpImage(b,data,length,type))return false;frame=true;}
    if(type==='ANMF'){
      if(length<32||!dimensions(1+b.readUIntLE(data+6,3),1+b.readUIntLE(data+9,3)))return false;
      let sub=data+16,found=false;while(sub+8<=data+length){const kind=b.toString('ascii',sub,sub+4),len=b.readUInt32LE(sub+4);if(len>data+length-sub-8)return false;if(kind==='VP8 '||kind==='VP8L'){if(!webpImage(b,sub+8,len,kind))return false;found=true;}sub+=8+len+(len%2);}if(!found||sub!==data+length)return false;frame=true;
    }
    offset=data+length+(length%2);
  }return frame&&offset===b.length;
}
function gifFrames(b) {
  let offset=13,frame=false;
  if(b[10]&128)offset+=3*(2<<(b[10]&7));
  function blocks(){let content=false;while(offset<b.length){const len=b[offset++];if(!len)return content;if(len>b.length-offset)return null;content=true;offset+=len;}return null;}
  while(offset<b.length){const tag=b[offset++];if(tag===59)return frame&&offset===b.length;
    if(tag===33){if(offset>=b.length)return false;offset++;if(blocks()===null)return false;}
    else if(tag===44){if(offset+9>b.length)return false;if(!dimensions(b.readUInt16LE(offset+4),b.readUInt16LE(offset+6)))return false;const packed=b[offset+8];offset+=9;if(packed&128)offset+=3*(2<<(packed&7));if(offset>=b.length||b[offset]<2||b[offset]>8)return false;offset++;if(blocks()!==true)return false;frame=true;}
    else return false;
  }return false;
}
function media(bytes,mime) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) fail('图片字节无效');
  const b = Buffer.from(bytes);
  if (!EXT[mime] || b.length < 16 || b.length > 5_000_000) fail('图片格式或大小无效，最大 5 MB');
  let valid = false;
  if (mime === 'image/png') valid = b.length >= 45 && b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && b.toString('ascii',12,16) === 'IHDR' && b.readUInt32BE(16)>0 && b.readUInt32BE(20)>0 && b.readUInt32BE(16)<=10000 && b.readUInt32BE(20)<=10000 && b.readUInt32BE(16)*b.readUInt32BE(20)<=40_000_000 && pngChunks(b);
  if (mime === 'image/jpeg') valid = jpegFrame(b);
  if (mime === 'image/webp') valid = b.toString('ascii',0,4)==='RIFF' && b.toString('ascii',8,12)==='WEBP' && b.readUInt32LE(4)===b.length-8 && webpFrame(b);
  if (mime === 'image/gif') valid = ['GIF87a','GIF89a'].includes(b.toString('ascii',0,6)) && b.readUInt16LE(6)>0 && b.readUInt16LE(8)>0 && dimensions(b.readUInt16LE(6),b.readUInt16LE(8)) && gifFrames(b);
  if (!valid) fail('图片内容与格式不匹配');
  return b;
}
function validateFeatures(input) {
  if (!object(input) || input.version!==1 || !integer(input.revision) || !object(input.memory) || !integer(input.memory.revision)) fail('功能备份格式无效');
  const unique = (items,label) => {const ids=new Set();for(const item of items){if(!uuid(item.id)||ids.has(item.id))fail(label+'编号无效或重复');ids.add(item.id);}return items;};
  const version = v => { if (!integer(v.version,1) || !['manual','model','restore'].includes(v.editor)) fail('记忆版本无效');return {version:v.version,text:text(v.text,30000),pinned:bool(v.pinned),enabled:bool(v.enabled),source:source(v.source),editor:v.editor,at:text(v.at,50)}; };
  const entries = unique(bounded(input.memory.entries,500).map(e => {
    const current=version(e),versions=bounded(e.versions,100).map(version);
    if(!versions.length || versions.some((v,i)=>i>0 && v.version<=versions[i-1].version) || JSON.stringify(versions.at(-1))!==JSON.stringify(current)) fail('记忆版本链无效');
    return {id:e.id,...current,versions};
  }),'记忆');
  const roles=unique(bounded(input.roles,50).map(r=>{if(!integer(r.version,1))fail('角色版本无效');return {id:r.id,name:text(r.name,80),text:text(r.text,20000),version:r.version,at:text(r.at,50)};}),'角色');
  if(input.selectedRoleId!==null && !roles.some(r=>r.id===input.selectedRoleId))fail('选中角色不存在');
  const feedback=unique(bounded(input.feedback,1000).map(f=>{if(!uuid(f.runId)||!['good','long','redundant'].includes(f.rating))fail('反馈来源或类型无效');return {id:f.id,runId:f.runId,rating:f.rating,note:text(f.note,500,false),active:bool(f.active),at:text(f.at,50),...(f.undoneAt?{undoneAt:text(f.undoneAt,50)}:{})};}),'反馈');
  const stickers=unique(bounded(input.stickers,100).map(s=>{if(!EXT[s.mime]||!integer(s.version,1)||!['manual','model'].includes(s.noteSource))fail('表情格式无效');return {id:s.id,mime:s.mime,name:text(s.name,80),note:text(s.note,500,false),noteSource:s.noteSource,enabled:bool(s.enabled),version:s.version,at:text(s.at,50)};}),'表情');
  const out={version:1,revision:input.revision,memory:{enabled:bool(input.memory.enabled),revision:input.memory.revision,entries},feedback,roles,selectedRoleId:input.selectedRoleId,stickersEnabled:bool(input.stickersEnabled),stickers};memorySize(out.memory);return out;
}

const PRIVATE_PARAMS=new Set(['bot_token','access_token','refresh_token','id_token','encrypt_query_param','aes_key','authorization','api_key','client_secret','password']);
function officialOAuth(url) {
  const rules={
    'auth.openai.com':/^\/(?:oauth\/(?:authorize|token)|authorize|auth\/callback)(?:\/|$)/,
    'auth0.openai.com':/^\/(?:authorize|oauth\/token|login\/callback)(?:\/|$)/,
    'chatgpt.com':/^\/(?:api\/)?auth\/callback(?:\/|$)/,
    'chat.openai.com':/^\/(?:api\/)?auth\/callback(?:\/|$)/,
    'accounts.google.com':/^\/(?:o\/oauth2\/(?:v2\/)?auth|signin\/oauth)(?:\/|$)/,
    'login.microsoftonline.com':/^\/[^/]+\/oauth2\/(?:v2\.0\/)?(?:authorize|token)(?:\/|$)/,
    'open.weixin.qq.com':/^\/connect\/(?:oauth2\/authorize|qrconnect)(?:\/|$)/
  };
  try{const u=new URL(url);return Boolean(rules[u.hostname.toLowerCase()]?.test(u.pathname));}catch{return false;}
}
function assignments(value) {
  return value.replace(/\bsk-[A-Za-z0-9_-]{16,}/g,'[凭据已移除]')
    .replace(/\b(authorization\s*[:=：]\s*)(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi,'$1[已移除]')
    .replace(/((?:["']?(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|bot[_ -]?token|aes[_ -]?key|encrypt[_ -]?query[_ -]?param|authorization|password|client[_ -]?secret|密码|访问令牌)["']?)\s*[:=：]\s*)(?:"[^"]*"|'[^']*'|[^\s;&,]+)/gi,'$1[已移除]');
}
function cleanUrl(raw,redact) {
  const oauth=officialOAuth(raw);
  const url=raw.replace(/^(https?:\/\/)[^/?#]*@/i,'$1');let changed=url!==raw;
  const hash=url.indexOf('#'),fragment=hash>=0?url.slice(hash+1):null,withoutHash=hash>=0?url.slice(0,hash):url;
  const question=withoutHash.indexOf('?'),base=question>=0?withoutHash.slice(0,question):withoutHash;
  const decode=value=>{try{return decodeURIComponent(value.replace(/\+/g,' '));}catch{return value;}};
  const params=value=>value.split('&').filter(part=>{
    const equals=part.indexOf('=');if(equals<0)return true;const key=decode(part.slice(0,equals)).toLowerCase();
    const keep=!PRIVATE_PARAMS.has(key)&&!(oauth&&['code','state'].includes(key));if(!keep)changed=true;return keep;
  }).map(part=>{
    const equals=part.indexOf('=');if(equals<0)return part;const original=part.slice(equals+1),decoded=decode(original),cleaned=redact(decoded).replace(/\bsk-[A-Za-z0-9_-]{16,}/g,'[凭据已移除]');
    if(cleaned!==decoded)changed=true;return cleaned===decoded?part:part.slice(0,equals+1)+encodeURIComponent(cleaned);
  }).join('&');
  const query=question>=0?params(withoutHash.slice(question+1)):null;
  let cleanFragment=fragment;
  if(fragment!==null&&fragment.includes('=')){const q=fragment.indexOf('?');cleanFragment=q>=0?fragment.slice(0,q+1)+params(fragment.slice(q+1)):params(fragment);}
  if(!changed)return raw;
  return base+(query!==null&&query?'?'+query:'')+(cleanFragment!==null&&cleanFragment?'#'+cleanFragment:'');
}
function cleanText(value,redact) {
  const raw=redact(value);let output='',cursor=0;
  for(const match of raw.matchAll(/https?:\/\/[^\s<>"']+/gi)){
    if(match.index<cursor)continue;
    const prefix=raw.slice(cursor,match.index),assigned=prefix.match(/((?:["']?(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|bot[_ -]?token|aes[_ -]?key|encrypt[_ -]?query[_ -]?param|authorization|password|client[_ -]?secret|密码|访问令牌)["']?)\s*[:=：]\s*)(?:["']|(?:Bearer|Basic)\s+)?$/i);
    cursor=match.index+match[0].length;
    if(assigned){output+=assignments(prefix.slice(0,assigned.index))+assigned[1]+'[已移除]';if(raw[cursor]==='"'||raw[cursor]==="'")cursor++;}
    else output+=assignments(prefix)+cleanUrl(match[0],redact);
  }
  return output+assignments(raw.slice(cursor));
}

export class ChatFeatures {
  constructor({store,vault,root=ROOT}) {
    this.store=store;this.vault=vault;this.root=path.resolve(root);this.previews=new Map();
    if(fs.existsSync(this.root)&&fs.lstatSync(this.root).isSymbolicLink())fail('工作目录不能是链接');
    if(!store.data.features){store.data.features=defaults();store.save();}
    else validateFeatures(store.data.features);
  }
  get data() { return this.store.data.features; }
  revision(body) { if(!object(body) || body.revision!==this.data.revision)conflict(); }
  commit(next) {
    next.revision=this.data.revision+1;validateFeatures(next);
    const previous=this.store.data.features;this.store.data.features=next;
    try{this.store.save();}catch(error){this.store.data.features=previous;throw error;}
    return this.status();
  }
  status() { return clone(this.data); }
  context(query,{sourceMessages=[]}={}) {
    if(typeof query!=='string'||query.length>50000)fail('检索文本格式无效');bounded(sourceMessages,100);
    const m=this.data.memory,entries=[];let used=0;
    if(m.enabled){
      for(const e of m.entries.filter(e=>e.enabled&&e.pinned)){entries.push(e);used+=e.text.length;}
      const q=new Set(words(query));
      const candidates=m.entries.filter(e=>e.enabled&&!e.pinned).map(e=>({e,score:words(e.text).filter(w=>q.has(w)).length})).filter(e=>e.score>0).sort((a,b)=>b.score-a.score);
      for(const {e} of candidates){if(entries.length>=12 || used+e.text.length>6000)continue;entries.push(e);used+=e.text.length;}
    }
    const active=this.data.feedback.filter(f=>f.active).slice(-30),counts={good:0,long:0,redundant:0};for(const f of active)counts[f.rating]++;
    const stickers=this.data.stickersEnabled?this.data.stickers.filter(s=>s.enabled).slice(0,30):[];
    return {memory:{enabled:m.enabled,revision:m.revision,entries:entries.map(({id,text,version,pinned,source})=>({id,text,version,pinned,source:clone(source)})),content:entries.map(e=>e.text).join('\n\n')},persona:this.data.roles.find(r=>r.id===this.data.selectedRoleId)?.text??null,feedbackHint:active.length?'主人表达反馈：合适 '+counts.good+' 次；太长 '+counts.long+' 次；多余 '+counts.redundant+' 次。作为柔性表达参考。'+active.filter(f=>f.note).slice(-6).map(f=>f.note).join('；'):'',stickers:stickers.map(({id,name,note,version})=>({id,name,note,version})),learningIds:stickers.filter(s=>!s.note).slice(0,2).map(({id,version})=>({id,version}))};
  }
  mutateMemory(body) {
    if(!object(body)||body.revision!==this.data.memory.revision)conflict();
    const next=clone(this.data),m=next.memory;
    if(body.action==='toggle')m.enabled=bool(body.enabled);
    else if(body.action==='add'){
      if(m.entries.length>=500)fail('记忆最多 500 条');
      const at=now(),entry={id:crypto.randomUUID(),text:text(body.text,30000),pinned:body.pinned===true,enabled:body.enabled!==false,version:1,source:{type:'manual',at},editor:'manual',at,versions:[]};entry.versions.push(memoryVersion(entry));m.entries.push(entry);
    }else{
      const e=m.entries.find(e=>e.id===body.id);if(!e)fail('记忆条目不存在');if(e.version!==body.version)conflict();
      if(e.versions.length>=100)fail('记忆版本最多 100 个');
      if(body.action==='restore'){const v=e.versions.find(v=>v.version===body.restoreVersion);if(!v)fail('历史版本不存在');Object.assign(e,{text:v.text,pinned:v.pinned,enabled:v.enabled,source:clone(v.source)});}
      else if(body.action==='edit'){e.text=text(body.text,30000);if(Object.hasOwn(body,'pinned'))e.pinned=bool(body.pinned);if(Object.hasOwn(body,'enabled'))e.enabled=bool(body.enabled);e.source={type:'manual',at:now()};}
      else fail('记忆操作无效');
      e.version++;e.editor='manual';e.at=now();e.versions.push(memoryVersion(e));
    }
    m.revision++;memorySize(m);this.commit(next);return clone(this.data.memory);
  }
  applyModel({memoryOps=[],stickerNotes=[]}={}, {sourceMessages=[],memoryContext,learningIds=[]}={}) {
    bounded(memoryOps,8);bounded(stickerNotes,2);bounded(sourceMessages,100);bounded(learningIds,2);
    const next=clone(this.data),result={memory:{applied:0,rejected:[]},stickers:{applied:0,rejected:[]}},owner=this.store.data.owner;
    const sources=new Map(sourceMessages.filter(s=>owner && s.kind==='user' && typeof s.sourceId==='string' && s.sourceId.startsWith(owner.botId+'/') && this.store.data.history.some(h=>h.kind==='user'&&!h.archival&&h.sourceId===s.sourceId && h.text===s.text && (s.id===undefined || h.id===s.id))).map(s=>[s.sourceId,s]));
    const visible=new Map((memoryContext?.entries??[]).map(e=>[e.id,e.version]));
    for(const op of memoryOps){try{
      if(!next.memory.enabled)fail('记忆已关闭');if(!object(op)||!sources.has(op.sourceMessageId))fail('来源不属于本轮当前主人原始消息');
      const candidate=clone(next.memory),at=now(),provenance={type:'model',sourceMessageId:op.sourceMessageId,at};
      if(op.action==='add'){
        if(candidate.entries.length>=500)fail('记忆最多 500 条');
        const e={id:crypto.randomUUID(),text:text(op.text,30000),pinned:false,enabled:true,version:1,source:provenance,editor:'model',at,versions:[]};e.versions.push(memoryVersion(e));candidate.entries.push(e);
      }else if(['revise','disable'].includes(op.action)){
        const e=candidate.entries.find(e=>e.id===op.id);if(!e||visible.get(op.id)!==op.version)fail('记忆未在本轮检索或版本不符');if(e.pinned)fail('置顶记忆受保护');if(e.version!==op.version)conflict();if(e.versions.length>=100)fail('记忆版本最多 100 个');
        if(op.action==='revise')e.text=text(op.text,30000);else e.enabled=false;e.version++;e.source=provenance;e.editor='model';e.at=at;e.versions.push(memoryVersion(e));
      }else fail('模型记忆动作无效');memorySize(candidate);next.memory=candidate;result.memory.applied++;
    }catch(error){result.memory.rejected.push(error.publicMessage??'记忆操作无效');}}
    const learning=new Map(learningIds.map(s=>[s.id,s.version]));
    for(const note of stickerNotes){try{
      const s=next.stickers.find(s=>s.id===note?.id);
      if(!next.stickersEnabled||!s?.enabled||!learning.has(s.id)||learning.get(s.id)!==s.version||s.note)fail('表情未提供、本轮版本失效或已有手动备注');
      s.note=text(note.note,500);s.noteSource='model';s.version++;s.at=now();result.stickers.applied++;
    }catch(error){result.stickers.rejected.push(error.publicMessage??'表情备注无效');}}
    if(result.memory.applied)next.memory.revision++;
    if(result.memory.applied||result.stickers.applied)this.commit(next);
    return result;
  }
  feedback(body) {
    this.revision(body);const next=clone(this.data);
    if(body.action==='undo'){const f=next.feedback.find(f=>f.id===body.id&&f.active);if(!f)fail('反馈不存在或已撤销');f.active=false;f.undoneAt=now();}
    else if(body.action==='add'){
      if(next.feedback.length>=1000)fail('反馈最多 1000 条');
      const run=this.store.data.runs.find(r=>r.id===body.runId);
      if(!run||run.status!=='completed'||!this.store.data.history.some(m=>m.kind==='assistant'&&m.runId===run.id)||!['good','long','redundant'].includes(body.rating))fail('只能反馈已有完成回复');
      next.feedback.push({id:crypto.randomUUID(),runId:run.id,rating:body.rating,note:text(body.note??'',500,false),active:true,at:now()});
    }else fail('反馈操作无效');this.commit(next);return clone(this.data.feedback);
  }
  role(body) {
    this.revision(body);const next=clone(this.data);
    if(body.action==='select'){if(body.id!==null&&!next.roles.some(r=>r.id===body.id))fail('角色不存在');next.selectedRoleId=body.id;}
    else if(['create','import'].includes(body.action)){if(next.roles.length>=50)fail('角色最多 50 个');next.roles.push({id:crypto.randomUUID(),name:text(body.name,80),text:text(body.text,20000),version:1,at:now()});}
    else if(body.action==='edit'){const r=next.roles.find(r=>r.id===body.id);if(!r)fail('角色不存在');if(r.version!==body.version)conflict();r.name=text(body.name??r.name,80);r.text=text(body.text,20000);r.version++;r.at=now();}
    else fail('角色操作无效');return this.commit(next);
  }
  directory(relative) {
    const dir=path.resolve(this.root,relative);if(!dir.startsWith(this.root+path.sep))fail('存储目录无效');
    let current=this.root;for(const part of path.relative(this.root,dir).split(path.sep)){current=path.join(current,part);if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())fail('存储目录不能是链接');}
    fs.mkdirSync(dir,{recursive:true});return dir;
  }
  stickerFile(id,mime) {if(!uuid(id)||!EXT[mime])fail('表情编号无效');const file=path.join(this.directory(path.join('state','stickers')),id+'.'+EXT[mime]);if(fs.existsSync(file)&&fs.lstatSync(file).isSymbolicLink())fail('表情文件不能是链接');return file;}
  addSticker(body) {
    this.revision(body);if(this.data.stickers.length>=100)fail('表情最多 100 张');
    const bytes=media(body.bytes,body.mime);if(bytes.length+this.data.stickers.reduce((n,s)=>n+fs.statSync(this.stickerFile(s.id,s.mime)).size,0)>50_000_000)fail('表情图片合计最大 50 MB');const id=crypto.randomUUID(),next=clone(this.data);
    const note=text(body.note??'',500,false);next.stickers.push({id,mime:body.mime,name:text(body.name,80),note,noteSource:'manual',enabled:true,version:1,at:now()});
    const file=this.stickerFile(id,body.mime);fs.writeFileSync(file,bytes,{flag:'wx'});
    try{this.commit(next);}catch(error){fs.unlinkSync(file);throw error;}
    return clone(this.data.stickers.at(-1));
  }
  updateSticker(body) {
    this.revision(body);const next=clone(this.data);
    if(body.action==='enable')next.stickersEnabled=bool(body.enabled);
    else{const s=next.stickers.find(s=>s.id===body.id);if(!s)fail('表情不存在');if(s.version!==body.version)conflict();
      if(body.action==='toggle')s.enabled=bool(body.enabled);
      else if(body.action==='edit'){if(Object.hasOwn(body,'name'))s.name=text(body.name,80);if(Object.hasOwn(body,'note')){s.note=text(body.note,500,false);s.noteSource='manual';}}
      else fail('表情操作无效');s.version++;s.at=now();}
    return this.commit(next);
  }
  loadSticker(id,{forPreview=false}={}) {const s=this.data.stickers.find(s=>s.id===id);if(!s||(!forPreview&&(!this.data.stickersEnabled||!s.enabled)))fail('表情不存在或已禁用');const bytes=media(fs.readFileSync(this.stickerFile(id,s.mime)),s.mime);return {bytes,mime:s.mime};}
  clean(value) {
    if(typeof value==='string')return cleanText(value,text=>this.vault?.redact?this.vault.redact(text):text);
    if(Array.isArray(value))return value.map(v=>this.clean(v));if(object(value))return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,this.clean(v)]));return value;
  }
  settings(input,models) {
    if(!object(input))fail('备份设置无效');
    const settings={model:input.model,reasoningEffort:input.reasoningEffort,serviceTier:input.serviceTier,persona:text(input.persona,20000,false),imageMode:input.imageMode??'requested'};
    if(!['off','requested','auto'].includes(settings.imageMode))fail('图片生成模式无效');
    if(settings.model===null){if(settings.reasoningEffort!==null||settings.serviceTier!==null)fail('空模型必须使用空推理强度和速度档位');}
    else{if(!Array.isArray(models))fail('模型目录无效');validateSettings(settings,models);}
    return settings;
  }
  exportBackup({includeHistory=false}={}) {
    bool(includeHistory);
    const s=this.store.data.settings,sections={settings:{model:s.model,reasoningEffort:s.reasoningEffort,serviceTier:s.serviceTier,persona:s.persona,imageMode:s.imageMode??'requested'},features:clone(this.data),stickers:this.data.stickers.map(s=>({id:s.id,mime:s.mime,base64:media(fs.readFileSync(this.stickerFile(s.id,s.mime)),s.mime).toString('base64')}))};
    if(includeHistory)sections.history=[...(this.store.data.archivedHistory??[]),...this.store.data.history].filter(m=>['user','assistant'].includes(m.kind)).slice(-10000).map(m=>({id:uuid(m.id)?m.id:crypto.randomUUID(),kind:m.kind,text:text(this.clean(String(m.text??'')),50000,false),time:text(String(m.time??''),50)}));
    return backupSize({format:'webot-chat-backup',version:1,createdAt:now(),sections:{...this.clean({...sections,stickers:undefined}),stickers:sections.stickers}});
  }
  validateBackup(data,models) {
    backupSize(data);
    if(!object(data)||data.format!=='webot-chat-backup'||data.version!==1||!object(data.sections)||Object.keys(data.sections).some(k=>!['settings','features','stickers','history'].includes(k)))fail('备份格式不支持');
    const s=data.sections,features=validateFeatures(this.clean(s.features)),settings=this.settings(this.clean(s.settings),models),seen=new Set();let total=0;
    const stickers=bounded(s.stickers,100).map(item=>{
      if(!uuid(item.id)||seen.has(item.id)||typeof item.base64!=='string'||item.base64.length>6_666_668||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.base64))fail('图片备份字节无效');
      seen.add(item.id);const b=media(Buffer.from(item.base64,'base64'),item.mime);total+=b.length;if(total>50_000_000)fail('图片备份合计最大 50 MB');return {id:item.id,mime:item.mime,base64:b.toString('base64')};
    });
    if(stickers.length!==features.stickers.length || features.stickers.some(s=>!stickers.some(m=>m.id===s.id&&m.mime===s.mime)))fail('表情目录与图片不匹配');
    const sections={features,settings,stickers};
    if(Object.hasOwn(s,'history'))sections.history=bounded(s.history,10000).map(m=>{if(!uuid(m.id)||!['user','assistant'].includes(m.kind))fail('历史记录无效');return {id:m.id,kind:m.kind,text:text(this.clean(m.text),50000,false),time:text(m.time,50),archival:true};});
    return {format:data.format,version:1,createdAt:text(data.createdAt,50),sections};
  }
  baseline(includeHistory) {
    const d=this.store.data,s=d.settings;
    const history=items=>items.filter(m=>['user','assistant'].includes(m.kind)).map(m=>({id:m.id,kind:m.kind,text:String(m.text??''),time:String(m.time??'')}));
    return JSON.stringify(this.clean({features:d.features,settings:{model:s.model,reasoningEffort:s.reasoningEffort,serviceTier:s.serviceTier,persona:s.persona,imageMode:s.imageMode??'requested'},...(includeHistory?{history:history(d.history),archivedHistory:history(d.archivedHistory??[])}:{})}));
  }
  previewBackup(data,models) {
    const normalized=this.validateBackup(data,models),at=Date.now(),includeHistory=Object.hasOwn(normalized.sections,'history');
    for(const [id,p] of this.previews)if(at-p.at>600000)this.previews.delete(id);if(this.previews.size>=10)this.previews.delete(this.previews.keys().next().value);
    const id=crypto.randomUUID(),current=this.exportBackup({includeHistory});this.previews.set(id,{data:normalized,at,baseline:this.baseline(includeHistory),includeHistory});
    return {id,expiresInSeconds:600,diff:Object.entries(normalized.sections).map(([section,value])=>({section,changed:JSON.stringify(current.sections[section])!==JSON.stringify(value)})),summary:{memory:normalized.sections.features.memory.entries.length,roles:normalized.sections.features.roles.length,stickers:normalized.sections.stickers.length,history:normalized.sections.history?.length??0}};
  }
  restoreBackup(id,{prepareNext}={}) {
    const p=this.previews.get(id);if(!p||Date.now()-p.at>600000)fail('恢复预览已过期');
    if(!this.store.data.paused||this.store.data.runs.some(r=>!['completed','failed','interrupted'].includes(r.status)))fail('请暂停并等待当前回复结束后恢复');
    if(this.baseline(p.includeHistory)!==p.baseline)conflict();
    const snapshot=path.join(this.directory(path.join('state','restore-snapshots')),crypto.randomUUID()+'.json');atomicJson(snapshot,this.exportBackup({includeHistory:true}));
    const previous=clone(this.store.data),created=[],s=p.data.sections,next=clone(this.store.data),features=clone(s.features),remap=new Map();
    try{
      for(const item of s.stickers){const newid=crypto.randomUUID(),file=this.stickerFile(newid,item.mime);fs.writeFileSync(file,media(Buffer.from(item.base64,'base64'),item.mime),{flag:'wx'});created.push(file);remap.set(item.id,newid);}
      for(const item of features.stickers)item.id=remap.get(item.id);features.revision=this.data.revision+1;features.memory.revision=this.data.memory.revision+1;
      next.features=features;next.settings={...next.settings,...s.settings};if(s.history)next.archivedHistory=clone(s.history);
      if(prepareNext){if(typeof prepareNext!=='function')fail('恢复准备方法无效');const prepared=prepareNext(next);if(prepared&&typeof prepared.then==='function')fail('恢复准备必须同步完成');}
      this.store.data=next;this.store.save();this.previews.delete(id);return {ok:true,snapshot:path.basename(snapshot),restored:Object.keys(s)};
    }catch(error){this.store.data=previous;for(const file of created)if(fs.existsSync(file))fs.unlinkSync(file);throw error;}
  }
}
