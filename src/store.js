import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const STATE = path.join(ROOT, 'state');
export const CODEX_HOME = path.join(ROOT, 'codex-home');
export const PORT = 3130;
export const DEFAULT_PERSONA = '你是我的日常 AI 助手。自然、直接、有自己的判断，闲聊时像熟悉的朋友，认真问题完整回答。可根据语境吐槽、调侃和使用普通粗口，不刻意客服化，也不强行为每句话加口癖。不假装做过未执行的事。';
export function atomicJson(file, data) {
  fs.mkdirSync(path.dirname(file), {recursive:true});
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(temp, JSON.stringify(data, null, 2)); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
export function readJson(file, initial) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : structuredClone(initial);
}
export function safeError(error) {
  const code = error?.code;
  if (code === 'AUTH_EXPIRED') return '微信登录已失效，需要重新扫码';
  if (code === 'RPC_DISCONNECTED') return 'Codex 连接已断开，本轮未自动重试';
  if (code === 'NETWORK') return '网络请求失败，请检查连接；发送结果可能未知';
  if (code === 'API') return `微信接口拒绝请求（错误码 ${error.apiCode ?? '未知'}）`;
  if (code === 'HTTP') return `微信接口 HTTP ${error.httpStatus}`;
  if (error?.publicMessage) return error.publicMessage;
  return '操作未完成，请检查连接和登录状态';
}
export function publicError(message) { const error = new Error(message); error.publicMessage = message; return error; }
export function losslessJson(text) {
  return JSON.parse(text, (key,value,context) => typeof value === 'number' && !Number.isSafeInteger(value) && Number.isInteger(value) ? context.source : value);
}
export class AppStore {
  constructor(file = path.join(STATE, 'assistant.json')) {
    this.file = file;
    this.data = readJson(file, {version:1, chatReady:true, settings:{model:null,reasoningEffort:null,serviceTier:null,persona:DEFAULT_PERSONA}, paused:false, owner:null, cursor:'', history:[], runs:[], threadId:null, generation:0, gate:{confirmed:false,checks:{}}, mediaEvidence:{imageReceive:0,imageSend:0},gateEpoch:0});
    this.data.gateEpoch??=0;
    if (this.data.version !== 1 || !Array.isArray(this.data.history) || !Array.isArray(this.data.runs)) throw publicError('运行数据格式无效，未覆盖原数据');
    for (const run of this.data.runs) if (!['completed','failed','interrupted'].includes(run.status)) {
      run.status='interrupted'; run.error='进程重启，本轮未自动重跑或重发';
      this.data.threadId=null;
    }
    for (const message of this.data.history) if (message.status==='queued') message.status='interrupted';
    this.save();
  }
  save() { atomicJson(this.file, this.data); }
  append(message) { const result={id:crypto.randomUUID(),time:new Date().toISOString(),...message}; this.data.history.push(result); this.save(); return result; }
}
