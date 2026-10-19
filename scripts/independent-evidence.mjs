export function publicSample(status,desktopCount,now=Date.now()) {
 const runtime=status?.runtime;
 return {time:new Date(now).toISOString(),desktopCount,runtime:runtime?{launchMode:runtime.launchMode,startedAt:runtime.startedAt,serverPid:runtime.serverPid,supervisorPid:runtime.supervisorPid,instanceId:runtime.instanceId,codexPid:runtime.codexPid}:null,
  codex:status?.codex?.state??null,wechat:status?.wechat?.state??null,pending:status?.chat?.pending??null,running:Boolean(status?.chat?.running),
  turns:(status?.runs??[]).filter(r=>r.status==='completed'&&!r.kind).map(r=>({id:r.id,startedAt:r.startedAt,finishedAt:r.finishedAt,
   acknowledged:(r.delivery??[]).length>0&&(r.delivery??[]).every(d=>d.acknowledged===true),generatedImages:r.generatedImages?.length??0}))};
}
export function updateEvidence(record,sample) {
 record.samples.push(sample);
 if(sample.desktopCount===0){record.absentSamples++;if(record.absentSamples===1)record.absentSince=sample.time;}
 else {record.absentSamples=0;record.absentSince=null;}
 if(record.absentSamples<2||sample.runtime?.launchMode!=='system-task'||sample.codex!=='ready')return;
 const turns=sample.turns.filter(t=>t.acknowledged&&Date.parse(t.startedAt)>=Date.parse(record.absentSince));
 if(!record.firstReply&&turns.length)record.firstReply={serverPid:sample.runtime.serverPid,instanceId:sample.runtime.instanceId,turnId:turns[0].id,time:sample.time};
 if(record.firstReply&&sample.runtime.instanceId!==record.firstReply.instanceId&&!record.restart){record.restart={serverPid:sample.runtime.serverPid,instanceId:sample.runtime.instanceId,time:sample.runtime.startedAt??sample.time};}
 if(record.restart&&!record.secondReply){const t=turns.find(t=>t.id!==record.firstReply.turnId&&Date.parse(t.startedAt)>=Date.parse(record.restart.time));if(t)record.secondReply={turnId:t.id,time:sample.time};}
 record.processAcceptance=Boolean(record.firstReply&&record.restart&&record.secondReply);
}
