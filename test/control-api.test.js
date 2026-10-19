import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createControlApi} from '../scripts/control-api.mjs';

const record={state:'running',pid:111,serverPid:222,instanceId:'owned-fixture-instance'};
const identity={launchMode:'system-task',supervisorPid:111,serverPid:222,instanceId:record.instanceId};
async function listener(handle){const server=http.createServer(handle);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return {server,origin:`http://127.0.0.1:${server.address().port}`};}
test('an unrelated HTTP listener never receives the control token or a control command',async()=>{
  const requests=[];
  const {server,origin}=await listener((req,res)=>{requests.push({url:req.url,authorization:req.headers.authorization});res.setHeader('Content-Type','application/json');res.end(JSON.stringify({...identity,instanceId:'foreign-fixture'}));});
  try{
    const api=createControlApi({origin,token:'synthetic-test-token',readMetadata:()=>record});
    await assert.rejects(api('/api/service/stop',{}),/不属于本部署/);
    assert.deepEqual(requests,[{url:'/api/instance',authorization:undefined}]);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('only a matching live instance receives the authenticated request',async()=>{
  const requests=[];
  const {server,origin}=await listener((req,res)=>{requests.push({url:req.url,authorization:req.headers.authorization});res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url==='/api/instance'?identity:{ok:true}));});
  try{
    const api=createControlApi({origin,token:'synthetic-test-token',readMetadata:()=>record});
    assert.deepEqual(await api('/api/status'),{ok:true});
    assert.deepEqual(requests,[{url:'/api/instance',authorization:undefined},{url:'/api/status',authorization:'Bearer synthetic-test-token'}]);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
