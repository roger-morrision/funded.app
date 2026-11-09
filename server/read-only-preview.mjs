import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { installRpcWebsocketProxy } from './rpc-websocket-proxy.mjs';

const reads = new Set(['getAccountInfo','getMultipleAccounts','getBalance','getTokenAccountsByOwner',
  'getTokenAccountBalance','getTokenSupply','getSupply','getSlot','getBlockHeight','getGenesisHash',
  'getHealth','getVersion','getLatestBlockhash','isBlockhashValid','getMinimumBalanceForRentExemption',
  'getSignatureStatuses','getSignaturesForAddress','getTransaction','getBlockTime','getEpochInfo']);
const deny = res => {
  res.writeHead(405, {'content-type':'application/json','cache-control':'no-store'});
  res.end(JSON.stringify({error:'Read-only preview: signing and account changes are disabled until server setup is complete.'}));
};

export function createReadOnlyPreview({upstream='http://app:8787', allowedOrigin='https://richpad.fun',
  rpcWebsocketUrl='wss://api.devnet.solana.com/'} = {}) {
  const target = new URL(upstream);
  if (target.protocol !== 'http:') throw new Error('The internal preview upstream must use HTTP.');
  const server = http.createServer(async (req,res) => {
    let body;
    try {
      const pathname = new URL(req.url,'http://preview').pathname;
      if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
        if (req.method !== 'POST' || pathname !== '/api/solana/rpc') return deny(res);
        const chunks=[]; let size=0;
        for await (const chunk of req) { size+=chunk.length; if(size>65536)return deny(res); chunks.push(chunk); }
        body=Buffer.concat(chunks);
        const rpc=JSON.parse(body.toString());
        if (Array.isArray(rpc)||rpc.jsonrpc!=='2.0'||!reads.has(rpc.method)||!Array.isArray(rpc.params))return deny(res);
      }
      const headers={...req.headers,host:target.host};
      delete headers.connection; delete headers['transfer-encoding'];
      if(body)headers['content-length']=String(body.length);
      const request=http.request({hostname:target.hostname,port:target.port,path:req.url,
        method:req.method==='HEAD'?'GET':req.method,headers},response=>{
        res.writeHead(response.statusCode,{...response.headers,'x-richpad-deployment':'code-only-devnet-preview'});
        if(req.method==='HEAD'){response.resume();res.end();}else response.pipe(res);
      });
      request.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});
      request.setTimeout(30000,()=>request.destroy());
      res.on('close',()=>request.destroy());
      request.end(body);
    } catch { if(!res.headersSent)deny(res);else res.end(); }
  });
  server.requestTimeout=30000;
  installRpcWebsocketProxy(server,{upstreamUrl:rpcWebsocketUrl,allowedOrigin,readOnly:true});
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createReadOnlyPreview().listen(8080,'0.0.0.0');
}
