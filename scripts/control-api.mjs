import {isManagedService} from './background-control.mjs';

export function createControlApi({origin,token,readMetadata,fetchImpl=fetch}) {
  return async function api(route,body) {
    const record=readMetadata();
    if(record?.state!=='running')throw Error('本部署后台未就绪');
    // Establish ownership without credentials before contacting an occupied port.
    const identity=await fetchImpl(origin+'/api/instance',{signal:AbortSignal.timeout(2000)});
    if(!identity.ok||!isManagedService({runtime:await identity.json()},record))throw Error('端口服务不属于本部署；未发送控制凭据');
    const response=await fetchImpl(origin+route,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(2000)});
    if(!response.ok)throw Error('Assistant control request was not accepted');
    return response.json();
  };
}
