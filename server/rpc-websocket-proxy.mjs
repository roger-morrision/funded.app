import {WebSocket,WebSocketServer} from 'ws';

export function installRpcWebsocketProxy(server,{upstreamUrl,allowedOrigin}={}){
  if(!upstreamUrl)return;
  const target=new URL(upstreamUrl);if(!['ws:','wss:'].includes(target.protocol))throw Error('Invalid RPC WebSocket target');
  const sockets=new WebSocketServer({noServer:true,maxPayload:16384,perMessageDeflate:false});
  const upgrade=(request,socket,head)=>{
    if(new URL(request.url,'http://localhost').pathname!=='/api/solana/ws'){socket.destroy();return;}
    const origin=request.headers.origin;
    let allowed=origin===allowedOrigin;
    try{allowed||=['http:','https:'].includes(new URL(origin).protocol)&&['localhost','127.0.0.1'].includes(new URL(origin).hostname);}catch{}
    if(!allowed){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
    sockets.handleUpgrade(request,socket,head,client=>{
      const remote=new WebSocket(target,{perMessageDeflate:false,handshakeTimeout:10000,maxPayload:16384});
      const pending=[];let pendingBytes=0;
      client.on('message',bytes=>{if(remote.readyState===WebSocket.OPEN)remote.send(bytes,{binary:false});
        else if(remote.readyState===WebSocket.CONNECTING&&pendingBytes+bytes.length<=32768){pending.push(bytes);pendingBytes+=bytes.length;}
        else client.close(1013,'RPC connection busy');});
      remote.on('open',()=>{for(const bytes of pending)remote.send(bytes,{binary:false});pending.length=0;pendingBytes=0;});
      remote.on('message',bytes=>{if(client.readyState===WebSocket.OPEN)client.send(bytes,{binary:false});});
      const close=()=>{client.terminate();remote.terminate();};
      client.on('close',()=>remote.terminate());remote.on('close',()=>client.close());client.on('error',close);remote.on('error',close);
    });
  };
  server.on('upgrade',upgrade);
  const close=()=>{server.removeListener('upgrade',upgrade);for(const client of sockets.clients)client.terminate();sockets.close();};
  server.once('close',close);return close;
}
