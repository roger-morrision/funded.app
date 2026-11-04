import {createServer} from 'vite';
import warmBrowserTests from './browser-test-warmup.mjs';

// Own Vite in the runner process. Windows shell-tree termination can otherwise
// leave npm/cmd/Vite alive after every browser assertion has finished.
export async function startBrowserTestServer(base,{factory=createServer,env=process.env}={}){
  const url=new URL(base);
  if(url.protocol!=='http:'||!['127.0.0.1','localhost'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)
    throw new Error('The managed browser server requires a plain loopback HTTP origin.');
  const overrides={VITE_API_BASE_URL:'/',VITE_SOLANA_CLUSTER:'devnet',VITE_EXPLORE_CLUSTER:'devnet',VITE_DEV_AUTOCONNECT:'false',
    VITE_FUNDED_TOKEN_MINT:env.VITE_FUNDED_TOKEN_MINT||'',VITE_FUNDED_SWAP_POOL:env.VITE_FUNDED_SWAP_POOL||'',VITE_CACHE_DIR:'tmp/playwright-vite-cache'};
  const previous=Object.fromEntries(Object.keys(overrides).map(key=>[key,env[key]]));
  Object.assign(env,overrides);
  let server,closing;
  const close=()=>closing??=(async()=>{
    try{await server?.close();}
    finally{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete env[key];else env[key]=value;}}
  })();
  try{
    server=await factory({configLoader:'native',server:{host:url.hostname,port:Number(url.port||80),strictPort:true,open:false}});
    await server.listen();
    return close;
  }catch(error){await close();throw error;}
}

export default async function setupBrowserTests(config,{start=startBrowserTestServer,warm=warmBrowserTests}={}){
  const base=config.projects[0]?.use?.baseURL;
  // Explicit integration configurations may supply their own server or URL.
  if(!base||config.webServer||!['localhost','127.0.0.1'].includes(new URL(base).hostname))return warm(config);
  const close=await start(base);
  try{await warm(config);}
  catch(error){await close();throw error;}
  return close;
}
