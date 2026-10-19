import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {assertPortAvailable} from '../scripts/port.mjs';

test('occupied loopback port is rejected without sending credentials or commands',async()=>{
  let received=0;
  const server=net.createServer(socket=>{socket.on('data',b=>{received+=b.length;});socket.end();});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{await assert.rejects(assertPortAvailable(server.address().port),/端口已被占用/);assert.equal(received,0);}
  finally{await new Promise(resolve=>server.close(resolve));}
});

test('a free loopback port passes the preflight',async()=>{
  const server=net.createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  await new Promise(resolve=>server.close(resolve));
  await assertPortAvailable(port);
});
