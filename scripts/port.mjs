import net from 'node:net';

// A TCP probe never authenticates to or sends commands to an existing service.
export function assertPortAvailable(port) {
  return new Promise((resolve,reject)=>{
    const socket=net.createConnection({host:'127.0.0.1',port});
    const finish=error=>{socket.removeAllListeners();socket.destroy();error?reject(error):resolve();};
    socket.once('connect',()=>finish(Error(`本机 ${port} 端口已被占用，或现有服务无法通过本部署鉴权；未接管或停止该服务。`)));
    socket.once('error',error=>finish(error.code==='ECONNREFUSED'?null:Error(`无法确认本机 ${port} 端口状态，请检查网络后手动重试。`)));
    socket.setTimeout(2000,()=>finish(Error(`检查本机 ${port} 端口超时；未启动其他实例。`)));
  });
}
