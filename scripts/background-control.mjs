export function isManagedService(status,record) {
 const r=status?.runtime;
 return Boolean(r?.launchMode==='system-task'&&Number.isInteger(r.serverPid)&&r.serverPid>0&&Number.isInteger(r.supervisorPid)&&r.supervisorPid>0&&
  typeof r.instanceId==='string'&&r.instanceId&&record?.state==='running'&&record.serverPid===r.serverPid&&record.pid===r.supervisorPid&&record.instanceId===r.instanceId);
}
export async function startManaged({readStatus,readMetadata,runTask,wait=ms=>new Promise(r=>setTimeout(r,ms)),attempts=40}) {
 const task=await runTask('Status');
 if(!task.registered)throw Error('Windows 独立后台任务尚未安装');
 const current=await readStatus();
 if(current){if(!isManagedService(current,readMetadata()))throw Error('旧启动方式的助手仍在运行，请先停止后再通过新入口启动');return current;}
 await runTask('Start');
 for(let i=0;i<attempts;i++){await wait(500);const status=await readStatus();if(status){if(!isManagedService(status,readMetadata()))throw Error('后台来源不匹配，未接管该进程');return status;}}
 throw Error('独立后台未就绪，请检查 logs/service.log 及任务运行结果；未回退到桌面进程启动');
}
export async function stopManaged({readStatus,readMetadata,requestStop,wait=ms=>new Promise(r=>setTimeout(r,ms)),attempts=24}) {
 const current=await readStatus();if(!current){if(['starting','running'].includes(readMetadata()?.state))throw Error('监督器记录仍显示运行，但控制接口不可用；请检查 supervisor.log，未强杀进程');return false;}
 await requestStop();
 for(let i=0;i<attempts;i++){
  await wait(250);
  if(await readStatus())continue;
  const record=readMetadata();
  if(current.runtime?.launchMode==='system-task'&&record?.instanceId===current.runtime.instanceId&&['starting','running'].includes(record.state))continue;
  return true;
 }
 throw Error('后台停止尚未确认；未强杀其他进程');
}
