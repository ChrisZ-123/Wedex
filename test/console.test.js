import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const app = fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const voidTags = new Set(['meta','link','input','img','br','hr']);

// Minimal offline DOM: exercises production handlers/renderers without browser, network or credentials.
class Element {
  constructor(tag, doc) {
    this.tagName=tag;this.doc=doc;this.children=[];this.attributes={};this.listeners={};this.parentNode=null;
    this._text='';this._value='';this.checked=false;this.disabled=false;this.hidden=false;this.open=false;this.files=[];this.style={};this.dataset={};
    this.classList={add:name=>{this.className=[this.className,name].filter(Boolean).join(' ');},toggle:(name,enable)=>{const all=new Set(this.className.split(/\s+/).filter(Boolean));if(enable)all.add(name);else all.delete(name);this.className=[...all].join(' ');}};
  }
  get id(){return this.attributes.id||'';} set id(value){this.attributes.id=value;this.doc.ids.set(value,this);}
  get className(){return this.attributes.class||'';} set className(value){this.attributes.class=value;}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  set textContent(value){this._text=String(value);this.children.forEach(child=>{child.parentNode=null;});this.children=[];}
  get value(){return this._value;} set value(value){this._value=String(value);}
  get src(){return this.attributes.src||'';} set src(value){this.attributes.src=value;}
  get isConnected(){return this===this.doc.body||Boolean(this.parentNode?.isConnected);}
  setAttribute(key,value){this.attributes[key]=String(value);if(key==='id')this.doc.ids.set(String(value),this);if(key==='hidden')this.hidden=true;if(key==='open')this.open=true;if(key==='value')this.value=value;if(key==='checked')this.checked=true;}
  getAttribute(key){return Object.hasOwn(this.attributes,key)?this.attributes[key]:null;}
  removeAttribute(key){delete this.attributes[key];}
  append(...nodes){for(const node of nodes){if(node.tagName==='#fragment'){this.append(...[...node.children]);continue;}node.remove();node.parentNode=this;this.children.push(node);}}
  replaceChildren(...nodes){this.children.forEach(node=>{node.parentNode=null;});this.children=[];this._text='';this.append(...nodes);if(this.tagName==='select')this.value=this.children[0]?.value||'';}
  insertBefore(node,current){if(!current){this.append(node);return;}node.remove();node.parentNode=this;this.children.splice(this.children.indexOf(current),0,node);}
  remove(){if(this.parentNode){const index=this.parentNode.children.indexOf(this);if(index>=0)this.parentNode.children.splice(index,1);this.parentNode=null;}}
  matches(selector){const match=/^(\w+)?(?:\.([\w-]+))?(?:\[([\w-]+)(?:="([^"]*)")?\])?$/.exec(selector);if(!match)throw new Error('Unsupported mock selector '+selector);return (!match[1]||this.tagName===match[1])&&(!match[2]||this.className.split(/\s+/).includes(match[2]))&&(!match[3]||(match[3]==='open'?this.open:Object.hasOwn(this.attributes,match[3]))&&(match[4]===undefined||this.attributes[match[3]]===match[4]));}
  querySelectorAll(selector){const result=[];for(const child of this.children){if(child.matches(selector))result.push(child);result.push(...child.querySelectorAll(selector));}return result;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
  async emit(type,event={}){if(type==='click'&&this.disabled)return;for(const fn of this.listeners[type]||[])await fn({preventDefault(){},...event});}
  click(){void this.emit('click');} focus(){this.doc.activeElement=this;}
  showModal(){this.open=true;} close(){this.open=false;}
}
function dom() {
  const doc={ids:new Map(),activeElement:null};doc.body=new Element('body',doc);
  doc.createElement=tag=>new Element(tag,doc);doc.createDocumentFragment=()=>new Element('#fragment',doc);
  doc.getElementById=id=>doc.ids.get(id)||null;doc.querySelectorAll=selector=>doc.body.querySelectorAll(selector);doc.querySelector=selector=>doc.body.querySelector(selector);
  const stack=[doc.body];
  for(const token of html.matchAll(/<\/?[^>]+>|[^<]+/g)) {
    const value=token[0];if(value.startsWith('<!'))continue;
    if(value.startsWith('</')) {const tag=value.slice(2,-1).trim();if(['html','head','body'].includes(tag))continue;assert.equal(stack.at(-1).tagName,tag,'HTML nesting: '+tag);stack.pop();continue;}
    if(value.startsWith('<')) {const tag=/^<([\w-]+)/.exec(value)?.[1];if(['html','head','body'].includes(tag))continue;const node=doc.createElement(tag);for(const attr of value.matchAll(/([\w-]+)(?:="([^"]*)")?/g)){if(attr[1]!==tag)node.setAttribute(attr[1],attr[2]??'');}stack.at(-1).append(node);if(!voidTags.has(tag))stack.push(node);}
    else stack.at(-1)._text+=value;
  }
  assert.equal(stack.length,1,'HTML unclosed tags');
  for(const form of doc.querySelectorAll('form')){form.elements={};for(const node of form.querySelectorAll('input'))if(node.attributes.name)form.elements[node.attributes.name]=node;}
  return doc;
}
const initialStatus=()=>({stage:'chat',gate:{confirmed:true,checks:{}},chat:{paused:false,running:null,pending:0},codex:{state:'ready',models:[{id:'official-model',displayName:'Official model',supportedReasoningEfforts:['high','xhigh'],defaultReasoningEffort:'high',serviceTiers:['priority'],defaultServiceTier:null}]},wechat:{state:'connected'},settings:{model:'official-model',reasoningEffort:'high',serviceTier:null,persona:'saved persona',imageMode:'requested'},history:[],runs:[],images:{status:'idle',inFlight:false,available:true},capabilities:{memory:true,nativeImages:true},mediaEvidence:{imageReceive:1,imageSend:1}});
const initialFeatures=()=>({revision:3,memory:{revision:2,enabled:true,entries:[]},feedback:[],roles:[],selectedRoleId:null,stickersEnabled:false,stickers:[]});
async function flush(){for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));}
function harness() {
  const document=dom(),calls=[],urls=[],revoked=[],stored=new Map();let data=initialStatus(),featureData=initialFeatures(),responder=null;
  const context=vm.createContext({document,location:{hash:'#token=offline-only-token',pathname:'/',search:''},history:{replaceState:()=>calls.push({strip:true})},sessionStorage:{setItem:(key,value)=>stored.set(key,value),getItem:key=>stored.get(key)},URL:Object.assign(class extends URL{}, {createObjectURL:blob=>{const value='blob:offline-'+urls.length;urls.push({value,blob});return value;},revokeObjectURL:value=>revoked.push(value)}),URLSearchParams,AbortController,Blob,Date,console,setTimeout:()=>1,clearTimeout(){},setInterval(){},window:{addEventListener(){},open(){return null;}},fetch:async(path,options)=>{calls.push({path,options});if(responder){const result=await responder(path,options);if(result)return result;}const body=path==='/api/status'?data:path==='/api/features'?featureData:path.startsWith('/api/history?')?{total:0,items:[]}:{ok:true};return {ok:true,status:200,json:async()=>structuredClone(body),blob:async()=>new Blob(['offline-image'],{type:'image/png'})};}});
  const exposed=`initializeToken(); globalThis.ui={renderRuns,runCards,renderModels,renderStatus,refreshStatus,refreshFeatures,mutate,api,authenticatedImage,loadHistory,activateTab,renderBackupPreview,openMemory,openRole,openSticker,renderFeatures,setStatus:value=>{status=value;renderStatus(value);updateButtons();},setFeatures:value=>{features=value;renderFeatures(value);updateButtons();}};`;
  vm.runInContext(app.replace(/initializeToken\(\);\s*refreshStatus\(\);\s*setInterval\(refreshStatus, 2000\);/,exposed),context);
  const ui=context.ui;ui.setStatus(data);ui.setFeatures(featureData);
  return {ui,document,calls,urls,revoked,$:id=>document.getElementById(id),setStatus:value=>{data=value;ui.setStatus(value);},setFeatures:value=>{featureData=value;ui.setFeatures(value);},respond:fn=>{responder=fn;},data:()=>data,features:()=>featureData};
}
const response=body=>({ok:true,status:200,json:async()=>body});

 test('HTML is nested correctly and tabs support keyboard selection',async()=>{
  const h=harness();assert.equal(h.$('stage').textContent,'完整聊天 · 已开放');assert.match(h.$('overview-wechat').textContent,/已连接/);
  await h.$('tab-activity').emit('keydown',{key:'ArrowRight'});assert.equal(h.$('tab-memory').getAttribute('aria-selected'),'true');assert.equal(h.$('view-memory').hidden,false);assert.equal(h.$('view-activity').hidden,true);assert.equal(h.document.activeElement,h.$('tab-memory'));
 });
 test('authentication stays in headers and OpenAI login URLs are constrained',async()=>{
  const h=harness();assert.equal(h.calls[0].strip,true);await h.ui.api('/api/status');const call=h.calls.find(call=>call.path==='/api/status');assert.equal(call.options.headers.Authorization,'Bearer offline-only-token');assert(!call.path.includes('token'));
  h.respond(path=>path==='/api/codex/login'?response({authUrl:'https://openai.com.evil.test/login'}):null);await h.$('codex-login').emit('click');await flush();assert.equal(h.$('auth-link').hidden,true);assert.match(h.$('notice').textContent,/可信/);
 });
 test('raw replies and edits survive polling; only public delivery evidence is shown',()=>{
  const h=harness();const run={id:'run-text',status:'completed',model:'official-model',imageMs:123,reply:'操，<script>literal</script>\nexact reply',delivery:[{acknowledged:true,clientId:'client-visible',messageId:'message-visible',text:'exact segment',contextToken:'NEVER-SHOW',url:'https://secret.test'}]};
  h.ui.renderRuns([run]);const card=h.ui.runCards.get(run.id);card.note.value='draft phone note';card.feedbackNote.value='draft feedback';h.ui.renderRuns([{...run,phoneConfirmed:true}]);
  assert.equal(card.raw.textContent,run.reply);assert.match(card.timing.textContent,/生图 123 ms/);assert.equal(card.note.value,'draft phone note');assert.equal(card.feedbackNote.value,'draft feedback');assert.match(card.deliverySegments.textContent,/client-visible/);assert(!card.root.textContent.includes('NEVER-SHOW'));assert(!card.root.textContent.includes('secret.test'));
 });
 test('image echo is media evidence and has image phone acceptance without invented model fields',()=>{
  const h=harness();h.setStatus({...h.data(),runs:[{id:'echo',kind:'image_echo',status:'completed',reply:'internal marker',phoneConfirmed:true,delivery:[{acknowledged:true,messageId:'image-msg'}]}]});const card=h.ui.runCards.get('echo');assert.match(card.meta.textContent,/无模型调用/);assert(!card.meta.textContent.includes('未知'));assert.equal(card.rawLabel.textContent,'图片传输说明');assert.equal(card.received.textContent,'手机完整收到图片');assert.match(card.receiptState.textContent,/完整收到图片/);assert.equal(card.feedback.hidden,true);assert.equal(card.received.disabled,false);
 });
 test('settings drafts preserve persona, runtime model choices and image mode across status updates',async()=>{
  const h=harness();h.$('persona').value='draft persona';h.$('effort').value='xhigh';h.$('service-tier').value='priority';h.$('image-mode').value='auto';await h.$('settings-form').emit('input');h.setStatus({...h.data(),settings:{...h.data().settings,persona:'server overwrites?',imageMode:'off'}});assert.equal(h.$('persona').value,'draft persona');assert.equal(h.$('effort').value,'xhigh');assert.equal(h.$('service-tier').value,'priority');assert.equal(h.$('image-mode').value,'auto');assert.equal(h.$('settings-state').textContent,'有未保存修改');
 });
 test('memory editor retains drafts and uses current memory revision with captured entry version',async()=>{
  const h=harness();const entry={id:'memory-id',version:1,text:'saved',pinned:false,enabled:true,versions:[],source:{type:'manual'}};h.setFeatures({...h.features(),memory:{revision:2,enabled:true,entries:[entry]}});h.ui.openMemory(entry);h.$('memory-text').value='typed draft';await h.$('memory-form').emit('input');h.setFeatures({...h.features(),revision:5,memory:{revision:4,enabled:true,entries:[{...entry,version:2,text:'concurrent update'}]}});assert.equal(h.$('memory-text').value,'typed draft');
  h.respond(path=>path==='/api/memory'?response({revision:5,entries:[{...entry,version:3}]}):null);await h.$('memory-form').emit('submit');await flush();const body=JSON.parse(h.calls.find(call=>call.path==='/api/memory').options.body);assert.equal(body.revision,4);assert.equal(body.version,1);assert.equal(body.text,'typed draft');
 });
 test('role card file import reads explicit text without history import',async()=>{
  const h=harness();h.ui.openRole('import');h.$('role-file').files=[{name:'QQ角色.md',size:100,text:async()=> '# Character\nSpeak naturally.'}];await h.$('role-file').emit('change');assert.equal(h.$('role-name').value,'QQ角色');assert.equal(h.$('role-text').value,'# Character\nSpeak naturally.');assert(!h.calls.some(call=>call.path?.startsWith('/api/history')));
  h.respond(path=>path==='/api/role'?response({...h.features(),revision:4,roles:[{id:'new-role',version:1}]}):null);await h.$('role-form').emit('submit');await flush();const body=JSON.parse(h.calls.find(call=>call.path==='/api/role').options.body);assert.equal(body.action,'import');assert.equal(body.name,'QQ角色');
 });
 test('backup restore requires concrete unexpired preview, pause and no running image job',async()=>{
  const h=harness();assert.equal(h.$('backup-restore').disabled,true);h.ui.renderBackupPreview({id:'preview-only-id',expiresInSeconds:600,diff:[{section:'settings',changed:true},{section:'transportSecrets',changed:true}],summary:{memory:2,roles:1,stickers:1,history:4}});assert.match(h.$('backup-diff').textContent,/将替换/);assert(!h.$('backup-diff').textContent.includes('transportSecrets'));assert.equal(h.$('backup-restore').disabled,true);
  h.setStatus({...h.data(),chat:{paused:true,running:null,pending:0},images:{inFlight:true}});assert.equal(h.$('backup-restore').disabled,true);h.setStatus({...h.data(),images:{inFlight:false,uncertain:true}});assert.equal(h.$('backup-restore').disabled,true);h.setStatus({...h.data(),images:{inFlight:false,uncertain:false}});assert.equal(h.$('backup-restore').disabled,false);await h.$('backup-restore').emit('click');await flush();assert.deepEqual(JSON.parse(h.calls.find(call=>call.path==='/api/backup/restore').options.body),{id:'preview-only-id'});
 });
 test('history supports encoded search and paging without exposing unknown fields',async()=>{
  const h=harness();h.respond(path=>path.startsWith('/api/history?')?response({total:202,items:[{kind:'user',text:'match text',archival:true,time:'2026-10-14',secret:'NEVER'}]}):null);await h.ui.loadHistory(0,'我 & 你');const call=h.calls.find(call=>call.path?.startsWith('/api/history?'));assert.equal(new URL(call.path,'http://offline').searchParams.get('q'),'我 & 你');assert.match(h.$('full-history-list').textContent,/导入存档/);assert(!h.$('full-history-list').textContent.includes('NEVER'));assert.equal(h.$('history-next').disabled,false);await h.$('history-next').emit('click');await flush();assert.equal(new URL(h.calls.filter(call=>call.path?.startsWith('/api/history?')).at(-1).path,'http://offline').searchParams.get('offset'),'100');
 });
 test('sticker preview uses authenticated blob and error-free metadata allowlist',async()=>{
  const h=harness();h.setFeatures({...h.features(),stickers:[{id:'12345678-1234-1234-1234-123456789abc',version:1,name:'Own sticker',note:'manual note',enabled:true,noteSource:'manual',mime:'image/png',transportKey:'NEVER'}]});await flush();const call=h.calls.find(call=>call.path?.startsWith('/api/stickers/image'));assert.equal(call.options.headers.Authorization,'Bearer offline-only-token');assert(!call.path.includes('token'));const image=h.$('sticker-list').querySelector('img');assert.match(image.src,/^blob:/);assert(!h.$('sticker-list').textContent.includes('NEVER'));
 });
 test('feature API failure does not fail connection or overwrite an open draft',async()=>{
  const h=harness();h.ui.openMemory();h.$('memory-text').value='unsaved';h.respond(path=>path==='/api/features'?{ok:false,status:404,json:async()=>({error:'未找到接口'})}:null);await h.ui.refreshFeatures();assert.match(h.$('feature-status').textContent,/尚不可用/);assert.equal(h.$('memory-text').value,'unsaved');await h.ui.refreshStatus();await flush();assert.equal(h.$('connection-state').textContent,'本地服务已连接');
 });
