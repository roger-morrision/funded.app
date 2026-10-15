import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction,
  VersionedTransaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { quoteAtomicReserveBuy } from '../launch-community-reserve.js';
import { submitPumpDevnetLaunch } from '../launch-flow.js';
import { buildFeeDistributionPolicy } from '../distribution-policy.js';
import { launchPolicyStatement } from '../launch-policy-auth.js';
import { devnetMetadataUri, metadataStatement } from '../devnet-metadata.js';

const base='https://funded.vip';
const execute=process.argv.includes('--execute');
const creator=Keypair.fromSecretKey(bs58.decode(readFileSync('.secrets/solana-devnet-creator-secret-key','utf8').trim()));
const funder=Keypair.fromSecretKey(bs58.decode(readFileSync('.secrets/funded-router-authority-secret-key','utf8').trim()));
assert.equal(creator.publicKey.toBase58(),'8ZCtLWxvBGwniEgybr1k89wS9NSaKrgxF4kPDvGvn1Wk');
assert.equal(funder.publicKey.toBase58(),'7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y');
const connection=new Connection(readFileSync('.secrets/solana-devnet-rpc-url','utf8').trim(),'finalized');
assert.equal(await connection.getGenesisHash(),'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
async function get(path){const response=await fetch(`${base}${path}`,{signal:AbortSignal.timeout(30_000)});
  assert(response.ok,`${path}: HTTP ${response.status}`);return response.json();}
async function post(path,input){const response=await fetch(`${base}${path}`,{method:'POST',
  headers:{origin:base,'content-type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(120_000)});
  const result=await response.json();assert(response.ok,`${path}: HTTP ${response.status} ${result.error||''}`);return result;}
const status=await get('/api/status');
const config=await get('/api/v3-launch-config');
const reserveConfig=await get('/api/launch-reserve-config');
assert.equal(status.cluster,'devnet');
assert.equal(status.status,'operational');
assert(config.ready && reserveConfig.programId===config.programId);
assert.equal(config.initialAuthority,funder.publicKey.toBase58());
const quote=await quoteAtomicReserveBuy({connection,supply:1_000_000_000,
  decimals:6,reserveTokens:30_000_000,developerBaseUnits:0n});
assert(quote.maxSolAmountLamports<=1_000_000_000n,'QA reserve exceeds 1 SOL.');
const creatorBalance=await connection.getBalance(creator.publicKey,'finalized');
const funderBalance=await connection.getBalance(funder.publicKey,'finalized');
const topUp=creatorBalance<300_000_000?300_000_000-creatorBalance:0;
assert(topUp<=300_000_000,'QA creator top-up exceeds the bound.');
assert(funderBalance-topUp>3_000_000_000,'QA trader must retain at least 3 SOL.');
console.log(JSON.stringify({stage:'preflight',cluster:'devnet',creator:creator.publicKey.toBase58(),
  funder:funder.publicKey.toBase58(),creatorBalanceLamports:creatorBalance,
  funderBalanceLamports:funderBalance,topUpLamports:topUp,
  reserveMaxLamports:String(quote.maxSolAmountLamports),programId:config.programId,execute}));
if(!execute)process.exit(0);
if(topUp){const signature=await sendAndConfirmTransaction(connection,new Transaction().add(SystemProgram.transfer({
  fromPubkey:funder.publicKey,toPubkey:creator.publicKey,lamports:topUp})),[funder],{commitment:'finalized'});
  console.log(JSON.stringify({stage:'creator-funded',signature,lamports:topUp}));}
const sign=(message)=>bs58.encode(nacl.sign.detached(new TextEncoder().encode(message),creator.secretKey));
const suffix=Date.now().toString(36).slice(-6);
const name=`Funded Holder QA ${suffix}`,symbol='FHQA';
const launch=await submitPumpDevnetLaunch({connection,payer:creator.publicKey,
  provider:{signTransaction:async tx=>{if(tx instanceof VersionedTransaction)tx.sign([creator]);
    else tx.partialSign(creator);return tx;}},
  input:{name,symbol,supply:1_000_000_000,decimals:6,initialBuyPercent:0,
    reserveTokens:30_000_000,maxInitialBuyLamports:quote.maxSolAmountLamports},
  feeRouterProgramId:config.programId,useMintRouter:true,
  v3FeeRouter:{programId:config.programId,initialAuthority:funder.publicKey.toBase58(),
    split:config.protocolSplit},reserveConfig,
  prepareMetadata:async({mint})=>{const record={mint,creatorWallet:creator.publicKey.toBase58(),
    name,symbol,description:'Disposable Devnet hourly holder payout QA coin. No monetary value.',
    tagline:'Holder payout QA',roadmap:'',website:'',x:'',telegram:'',discord:'',imageSha256:''};
    const saved=await post('/api/devnet-metadata',{...record,imageBase64:'',imageType:'',
      signature:sign(metadataStatement(record))});
    assert.equal(saved.uri,devnetMetadataUri(mint));return saved.uri;},
  onJournal:event=>{if(event.signature)console.log(JSON.stringify({stage:'launch-step',
    state:event.state,step:event.step,signature:event.signature}));}});
const mint=(launch.mint.publicKey||launch.mint).toBase58();
const feeDistribution=buildFeeDistributionPolicy({creatorWalletPercent:0,
  holderAirdropPercent:80,solClaimPercent:0,xRecipient:'',
  feeRouterAddress:launch.feeRouter.toBase58()});
const policy={mint,chain:'solana',cluster:'devnet',signature:launch.signature,
  creatorWallet:creator.publicKey.toBase58(),communityAllocation:3,
  feeDistribution,pumpFeeRoute:{router:launch.feeRouter.toBase58(),scope:'per-mint-v3',
    transaction:launch.signature,programId:config.programId,
    initialAuthority:funder.publicKey.toBase58(),protocolSplit:config.protocolSplit}};
const registered=await post('/api/launches',{...policy,
  policySignature:sign(launchPolicyStatement(policy))});
assert(registered.onchainVerified && registered.pumpFeeRoute?.scope==='per-mint-v3');
console.log(JSON.stringify({stage:'launch-registered',mint,signature:launch.signature,
  creator:creator.publicKey.toBase58(),holderPercent:80,
  router:launch.feeRouter.toBase58(),name}));
process.exit(0);
