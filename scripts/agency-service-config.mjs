// Reuse only the app's independent price-signer connection. Never copy its
// wallet, SMTP or X credentials into the buyback-only worker.
export function wireAgencyPriceSigner(config) {
  const app=config.services?.app, worker=config.services?.['agency-buyback-worker'];
  if(!app||!worker)throw Error('App and agency worker services are required.');
  const env=app.environment||{}, target=worker.environment||={};
  const keys=['FUNDED_DEVNET_BUYBACK_PRICE_SIGNER','FUNDED_DEVNET_BUYBACK_PRICE_SIGNER_URL','FUNDED_DEVNET_BUYBACK_PRICE_SIGNER_TOKEN_FILE'];
  if(!env[keys[0]]||!env[keys[1]]){
    if(target.FUNDED_V3_AGENCY_BUYBACK_ENABLED==='true')throw Error('Enabled agency buybacks require the independent price signer.');
    return config;
  }
  if(env.SOLANA_CLUSTER!=='devnet'||target.SOLANA_CLUSTER!=='devnet')throw Error('Agency signer wiring requires Devnet.');
  const endpoint=new URL(env[keys[1]]);
  if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw Error('An exact HTTPS signer endpoint is required.');
  const file=env[keys[2]];
  if(file){
    const mountPath=mount=>{
      const name=typeof mount==='string'?mount:mount.target||mount.source;
      return name.startsWith('/')?name:'/run/secrets/'+name;
    };
    const mount=(app.secrets||[]).find(row=>mountPath(row)===file);
    if(!mount)throw Error('The signer token file must be an existing app secret mount.');
    const source=typeof mount==='string'?mount:mount.source;
    if(!config.secrets?.[source])throw Error('The signer token secret is not defined.');
    worker.secrets||=[];
    const existing=worker.secrets.find(row=>mountPath(row)===file);
    if(existing&&JSON.stringify(existing)!==JSON.stringify(mount))throw Error('Conflicting signer secret mount.');
    if(!existing)worker.secrets.push(structuredClone(mount));
  }
  for(const key of keys){if(env[key])target[key]=env[key];else delete target[key];}
  return config;
}
