import {createServer} from 'node:http';
import {WebSocketServer,WebSocket} from 'ws';

async function body(req){
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>1000000)throw Error('Request too large');chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// SDK signature subscriptions share one HTTP status poll across every client.
// No second upstream connection or provider WebSocket subscription is opened.
export function createRpcSignatureServer({gateway,pollIntervalMs=2000,maxSubscriptions=512}={}){
  const server=createServer((_req,res)=>{res.writeHead(404);res.end();});
  const sockets=new WebSocketServer({server,maxPayload:16384,perMessageDeflate:false});
  const subscriptions=new Map();let sequence=0,polling=false,closed=false;
  const send=(socket,value)=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(value));};
  sockets.on('connection',socket=>{
    const owned=new Set();
    socket.on('error',()=>{});
    socket.on('close',()=>{for(const id of owned)subscriptions.delete(id);});
    socket.on('message',bytes=>{
      let request;try{request=JSON.parse(bytes.toString());}catch{send(socket,{jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid JSON'}});return;}
      const id=request.id??null,reply=result=>send(socket,{jsonrpc:'2.0',id,result});
      const reject=message=>send(socket,{jsonrpc:'2.0',id,error:{code:-32602,message}});
      if(request.jsonrpc!=='2.0')return reject('Invalid JSON-RPC request');
      if(request.method==='ping'){if(Object.hasOwn(request,'id'))reply(true);return;}
      if(request.method==='signatureUnsubscribe'){
        const key=request.params?.[0],found=owned.delete(key);if(found)subscriptions.delete(key);reply(found);return;
      }
      if(request.method!=='signatureSubscribe')return reject('Only transaction signature subscriptions are supported');
      const [signature,options={}]=request.params||[];
      if(!/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(signature||'')||!['processed','confirmed','finalized'].includes(options.commitment||'finalized'))return reject('Invalid signature or commitment');
      if(owned.size>=32||subscriptions.size>=maxSubscriptions)return reject('Signature subscription limit reached');
      const key=++sequence;owned.add(key);subscriptions.set(key,{socket,owned,signature,commitment:options.commitment||'finalized'});reply(key);
    });
  });
  async function poll(){
    if(closed||polling||!subscriptions.size)return;polling=true;
    try{
      const signatures=[...new Set([...subscriptions.values()].map(row=>row.signature))];
      for(let start=0;start<signatures.length;start+=256){
        const selected=signatures.slice(start,start+256),response=await gateway.request({jsonrpc:'2.0',id:'signature-poll',method:'getSignatureStatuses',params:[selected,{searchTransactionHistory:true}]});
        const result=response.body.result;if(response.body.error||!Number.isSafeInteger(result?.context?.slot)||!Array.isArray(result?.value)||result.value.length!==selected.length)continue;
        const bySignature=new Map(selected.map((signature,index)=>[signature,result.value[index]]));
        for(const [id,row] of subscriptions){
          const status=bySignature.get(row.signature);if(!status||!Number.isSafeInteger(status.slot)||!Object.hasOwn(status,'err'))continue;
          const rank={processed:0,confirmed:1,finalized:2},level=status.confirmationStatus||(status.confirmations===null?'finalized':'processed');
          if(!Object.hasOwn(rank,level)||rank[level]<rank[row.commitment])continue;
          send(row.socket,{jsonrpc:'2.0',method:'signatureNotification',params:{subscription:id,result:{context:result.context,value:{err:status.err}}}});
          subscriptions.delete(id);row.owned.delete(id);
        }
      }
    }finally{polling=false;}
  }
  const timer=setInterval(()=>{void poll().catch(()=>{});},pollIntervalMs);timer.unref();
  return{server,poll,subscriptionCount:()=>subscriptions.size,close:async()=>{
    closed=true;clearInterval(timer);for(const socket of sockets.clients)socket.terminate();
    await new Promise(resolve=>sockets.close(resolve));if(server.listening)await new Promise(resolve=>server.close(resolve));
  }};
}

export function createRpcGatewayServer({gateway}={}){
  const server=createServer(async(req,res)=>{
    const json=(status,value)=>{if(res.destroyed)return;res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
    if(req.method==='GET'&&req.url==='/health')return json(gateway.stats().upstreamVerified?200:503,{ok:gateway.stats().upstreamVerified,cluster:'devnet'});
    if(req.method==='GET'&&req.url==='/metrics')return json(200,gateway.stats());
    if(req.method!=='POST'||req.url!=='/')return json(404,{error:'Not found'});
    try{
      const input=await body(req);
      if(Array.isArray(input)){
        if(!input.length||input.length>100)return json(400,{error:'A batch must contain 1 to 100 requests'});
        const results=await Promise.all(input.map(request=>gateway.request(request)));return json(200,results.map(row=>row.body));
      }
      const response=await gateway.request(input);return json(response.httpStatus,response.body);
    }catch{return json(400,{jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid RPC request'}});}
  });
  server.headersTimeout=10000;server.requestTimeout=30000;server.keepAliveTimeout=30000;
  return server;
}
