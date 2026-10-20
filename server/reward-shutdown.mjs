import {drainAutomaticRewardTransactions} from './automatic-reward-store.mjs';

export function installRewardShutdown({server,handle,signals=process,drain=drainAutomaticRewardTransactions,
  exit=code=>process.exit(code),logger=console}) {
  if(typeof handle!=='function'||server.listenerCount('request'))throw new TypeError('Shutdown must own HTTP request admission.');
  let shuttingDown=false,handlerFailed=false;
  const handlers=new Set(),writeResponses=new Set();
  const track=(set,pending)=>{
    set.add(pending);
    void pending.then(()=>set.delete(pending),()=>{handlerFailed=true;set.delete(pending);});
    return pending;
  };
  server.on('request',(req,res)=>{
    // server.close stops new connections; existing keepalive/pipelined sockets
    // must also stop admitting work before the ledger can be sealed.
    if(shuttingDown){res.writeHead(503,{'connection':'close'});res.end();return;}
    if(!['GET','HEAD','OPTIONS'].includes(req.method)){
      track(writeResponses,new Promise(resolve=>{
        res.once('finish',resolve);res.once('close',resolve);
      }));
    }
    // A client disconnect/response finish does not prove its async handler has
    // completed. Even GET handlers can perform writes (e.g. auth callbacks).
    track(handlers,Promise.resolve().then(()=>handle(req,res)));
  });
  const stop=signal=>{
    if(shuttingDown)return;shuttingDown=true;
    let stage='http-handlers';
    logger.log(JSON.stringify({event:'reward_shutdown_started',signal,handlers:handlers.size,writeResponses:writeResponses.size}));
    const requestsClosed=new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    // Attach the rejection handler now, while waiting for admitted handlers.
    void requestsClosed.catch(()=>{});
    void (async()=>{
      if(handlerFailed)throw new Error('HTTP handler completion unconfirmed.');
      await Promise.all([...handlers,...writeResponses]);
      if(handlerFailed)throw new Error('HTTP handler completion unconfirmed.');
      stage='ledger';
      await drain();
      // All admitted application logic and mutating responses have finished.
      // Only readonly responses or sockets without admitted work can remain.
      // Close these before awaiting server.close, otherwise a stream can pin it.
      stage='http-connections';server.closeAllConnections();
      await requestsClosed;
      logger.log(JSON.stringify({event:'reward_ledger_drained',signal}));
      exit(0);
    })().catch(()=>logger.error(JSON.stringify({event:'reward_shutdown_failed',signal,stage,code:'DRAIN_UNCONFIRMED'})));
  };
  // Repeated signals must not fall through to default process termination while
  // a mutation or ledger write is pending.
  for(const signal of ['SIGTERM','SIGINT'])signals.on(signal,()=>stop(signal));
}
