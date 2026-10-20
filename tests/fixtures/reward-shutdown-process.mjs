// Isolated lifecycle fixture: loopback HTTP, in-memory gates, no database,
// automatic workers, signing credentials or ledger state.
import {createServer} from 'node:http';
import {installRewardShutdown} from '../../server/reward-shutdown.mjs';

const mode=process.argv[2];
let releaseLedger,releaseWrite,rejectLedger;
const ledger=new Promise((resolve,reject)=>{releaseLedger=resolve;rejectLedger=reject;});
const write=new Promise(resolve=>{releaseWrite=resolve;});
const send=data=>process.send?.(data);
const server=createServer();
installRewardShutdown({server,handle:async(req,res)=>{
  send({event:'admitted',method:req.method,path:req.url});
  if(req.url==='/idle'){res.end('done');return;}
  res.writeHead(200,{'content-type':'text/plain'});res.write('pending\n');
  const timer=setInterval(()=>res.write('heartbeat\n'),25);
  res.once('close',()=>clearInterval(timer));
  if(['write','get-handler','handler-failure'].includes(mode)){
    await write;
    send({event:'handler-completed'});
    if(mode==='handler-failure')throw Error('Simulated uncertain handler failure');
    res.end('complete');
  }else if(mode==='write-response'){
    void write.then(()=>res.end('complete'));
  }
},drain:async()=>{
  send({event:'drain-started'});
  if(mode==='ledger'||mode==='ledger-failure')await ledger;
  send({event:'drain-resolved'});
},logger:{
  log:line=>{console.log(line);send(JSON.parse(line));},
  error:line=>{console.error(line);send(JSON.parse(line));},
}});
server.timeout=100;
process.on('message',message=>{
  if(message==='release-ledger')releaseLedger();
  if(message==='reject-ledger')rejectLedger(Error('Simulated uncertain ledger completion'));
  if(message==='release-write')releaseWrite();
});
server.listen(0,'127.0.0.1',()=>send({event:'listening',port:server.address().port}));
