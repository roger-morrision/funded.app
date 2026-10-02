import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const directory=await mkdtemp(join(tmpdir(),'funded-referral-privacy-'));
const wallet='11111111111111111111111111111111';
const claim={id:'privacy-fixture',settlementSignature:'settlement-fixture',level:1,recipientWallet:wallet,amount:0.01,asset:'SOL',nonce:'fixture',status:'wallet-verified',publicKey:wallet,createdAt:'2026-10-01T00:00:00.000Z',expiresAt:'2099-01-01T00:00:00.000Z'};
const statePath=join(directory,'state.json');
await writeFile(statePath,JSON.stringify({version:4,launches:{},settlements:{},collections:{},obligations:{},claims:{},referralClaims:{[claim.id]:claim},payouts:{},referrals:{codes:{},wallets:{},attributions:{},challenges:{}}}));
const base=`http://127.0.0.1:${port}`;
const blank={SOLANA_KEEPER_SECRET_KEY:'',SOLANA_KEEPER_KEYPAIR_PATH:'',SOLANA_REFERRAL_PAYOUT_SECRET_KEY:'',SOLANA_REFERRAL_PAYOUT_KEYPAIR_PATH:'',FUNDED_ROUTER_AUTHORITY_SECRET_KEY:'',FUNDED_ROUTER_AUTHORITY_KEYPAIR_PATH:'',SOLANA_DEVNET_CREATOR_SECRET_KEY:'',SOLANA_DEVNET_REFERRER_SECRET_KEY:'',SOLANA_DEVNET_CLAIMANT_SECRET_KEY:''};
const child=spawn(process.execPath,['server/index.mjs'],{cwd:process.cwd(),env:{...process.env,...blank,FUNDED_SKIP_LOCAL_ENV:'true',NODE_ENV:'test',DEV_MODE:'false',DEVNET_TEST_MODE:'false',HOST:'127.0.0.1',PORT:String(port),FUNDED_STORE_PATH:statePath,DATABASE_URL:'',FUNDED_API_TOKEN:'synthetic-ops-token',SOLANA_ALLOW_KEEPER_TRANSFER:'false'},stdio:'ignore'});
try{
  for(let attempt=0;attempt<50;attempt++){try{if((await fetch(`${base}/api/health`)).ok)break;}catch{}if(attempt===49)throw new Error('Isolated API did not start.');await new Promise(resolve=>setTimeout(resolve,100));}
  const publicState=await(await fetch(`${base}/api/state`)).json();
  assert.equal(Object.hasOwn(publicState,'referralClaims'),false);
  assert.equal((await fetch(`${base}/api/referral-claims?wallet=${wallet}`)).status,401);
  assert.equal((await fetch(`${base}/api/referrals/dashboard?wallet=${wallet}`)).status,401);
  assert.equal((await fetch(`${base}/api/referral-claims/${claim.id}/execute`,{method:'POST',headers:{origin:base,'content-type':'application/json'},body:'{}'})).status,403);
  console.log('Referral privacy HTTP: public state redaction, wallet-scoped claim/dashboard reads and authenticated execution gate passed. No signing, secret, worker, RPC or payout used.');
}finally{
  if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}
  await rm(directory,{recursive:true,force:true});
}
