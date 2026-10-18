import {drainAutomaticRewardTransactions} from './automatic-reward-store.mjs';

export function installRewardShutdown({server,signals=process,drain=drainAutomaticRewardTransactions,
  exit=code=>process.exit(code),logger=console}) {
  let shuttingDown=false;
  const stop=signal=>{
    if(shuttingDown)return;shuttingDown=true;
    const requestsClosed=new Promise(resolve=>server.close(resolve));
    void Promise.all([requestsClosed,drain()]).then(()=>{
      logger.log(JSON.stringify({event:'reward_ledger_drained',signal}));
      server.closeAllConnections();exit(0);
    });
  };
  for(const signal of ['SIGTERM','SIGINT'])signals.once(signal,()=>stop(signal));
}
