import test from 'node:test';
import assert from 'node:assert/strict';
import BN from 'bn.js';
import {Keypair,PublicKey,TransactionInstruction,AddressLookupTableAccount} from '@solana/web3.js';
import {MintLayout,AccountLayout,TOKEN_PROGRAM_ID,getAssociatedTokenAddressSync} from '@solana/spl-token';
import {OnlinePumpSdk,PUMP_SDK} from '@pump-fun/pump-sdk';
import {submitPumpDevnetLaunch} from '../../launch-flow.js';
import {deriveFeeRouter,buildExpectedFeeRouterAccountPrefix} from '../../fee-router.js';
import {launchReserveAddresses} from '../../launch-community-reserve.js';
import {PROTOCOL_FEE_SPLIT} from '../../config/protocol-fee-split.js';
import {SOLANA_GENESIS} from '../../solana-network.js';

// Mock chain accounts and an oversized Pump instruction. This executes the real
// launch orchestration and compiler, but never accesses a network or real wallet.
function fixture(t){
  const key=n=>Keypair.fromSeed(new Uint8Array(32).fill(n)).publicKey;
  const payer=key(81),authority=key(82),program=key(83),richMint=key(84),lookup=key(85),treasury=key(86);
  const router=deriveFeeRouter(program),header=Buffer.alloc(74);Buffer.from(buildExpectedFeeRouterAccountPrefix()).copy(header);
  authority.toBuffer().copy(header,41);header[73]=router.bump;
  const rich=Buffer.alloc(MintLayout.span),account=Buffer.alloc(AccountLayout.span);
  MintLayout.encode({mintAuthorityOption:0,mintAuthority:PublicKey.default,supply:100_000n,decimals:0,isInitialized:true,
    freezeAuthorityOption:0,freezeAuthority:PublicKey.default},rich);
  AccountLayout.encode({mint:richMint,owner:payer,amount:100_000n,delegateOption:0,delegate:PublicKey.default,state:1,
    isNativeOption:0,isNative:0n,delegatedAmount:0n,closeAuthorityOption:0,closeAuthority:PublicKey.default},account);
  const richAta=getAssociatedTokenAddressSync(richMint,payer);
  const f={mint:null,walletCalls:0,sends:0,preparationComplete:false,pumpBytes:1300};
  const global={tokenTotalSupply:new BN('1000000000000000'),initialVirtualTokenReserves:new BN('1073000000000000'),
    initialVirtualSolReserves:new BN('30000000000'),initialRealTokenReserves:new BN('793100000000000'),
    feeBasisPoints:new BN(100),creatorFeeBasisPoints:new BN(50)};
  t.mock.method(OnlinePumpSdk.prototype,'fetchGlobal',async()=>global);
  t.mock.method(PUMP_SDK,'createV2AndBuyInstructions',async({mint,user})=>{
    assert.equal(f.preparationComplete,true,'Recovery preparation must finish before building the launch.');
    return [new TransactionInstruction({programId:key(87),keys:[{pubkey:mint,isSigner:true,isWritable:true},
      {pubkey:user,isSigner:true,isWritable:true}],data:Buffer.alloc(f.pumpBytes)})];
  });
  const expiresAt=new Date(Date.now()+900_000).toISOString();
  f.input={cluster:'devnet',payer,input:{name:'Fixture',symbol:'FIX',supply:1_000_000_000,decimals:6,
    initialBuySol:0,reserveTokens:30_000_000,feeShares:{creatorWalletPercent:80,holderAirdropPercent:0,solClaimPercent:0}},
  v3FeeRouter:{programId:String(program),initialAuthority:String(authority),split:PROTOCOL_FEE_SPLIT},
  feeRouterProgramId:String(program),useMintRouter:true,reserveConfig:{programId:String(program),authority:String(authority),lookupTable:String(lookup)},
  launchServiceQuote:{id:'launch_service_1_0123456789abcdef',amountLamports:'1',payer:String(payer),recipient:String(treasury),
    policyHash:'a'.repeat(64),expiresAt,cluster:'devnet',genesisHash:SOLANA_GENESIS.devnet},
  launchBurn:{tier:'pro',amountTokens:100,fundedMint:String(richMint),quoteId:'launch_tier_1_0123456789abcdef',quoteExpiresAt:expiresAt},
  onJournal:async event=>{if(event.state==='prepared'){f.mint=event.mint;await new Promise(resolve=>setImmediate(resolve));f.preparationComplete=true;}},
  provider:{signTransaction:async()=>{f.walletCalls++;throw Error('No wallet should be called before size verification');}},
  connection:{getGenesisHash:async()=>SOLANA_GENESIS.devnet,getLatestBlockhash:async()=>({blockhash:String(key(88)),lastValidBlockHeight:100}),
    getAccountInfo:async address=>{
      if(address.equals(router.address))return {data:header,owner:program,executable:false};
      if(address.equals(richMint))return {data:rich,owner:TOKEN_PROGRAM_ID,executable:false};
      if(address.equals(richAta))return {data:account,owner:TOKEN_PROGRAM_ID,executable:false};
      throw Error('Unexpected mocked account read');},
    getAddressLookupTable:async()=>{const reserve=launchReserveAddresses({mint:f.mint,payer,programId:program,authority});
      return {value:new AddressLookupTableAccount({key:lookup,state:{deactivationSlot:0xffffffffffffffffn,
        lastExtendedSlot:1,lastExtendedSlotStartIndex:0,addresses:[reserve.source,reserve.destination,reserve.vault]}})};},
    sendRawTransaction:async()=>{f.sends++;throw Error('No broadcast expected');}}};
  return f;
}

test('oversized launch fails before promotion burn or wallet approval',async t=>{
  const f=fixture(t);
  await assert.rejects(submitPumpDevnetLaunch(f.input),/above Solana.s limit|exceeds.*size limit/);
  assert.equal(f.preparationComplete,true);assert.equal(f.walletCalls,0);assert.equal(f.sends,0);
});

test('launch preparation persistence failure stops before mint use or promotion burn',async t=>{
  const f=fixture(t);f.input.onJournal=async()=>{throw Error('Preparation store unavailable');};
  await assert.rejects(submitPumpDevnetLaunch(f.input),/Preparation store unavailable/);
  assert.equal(f.preparationComplete,false);assert.equal(f.walletCalls,0);assert.equal(f.sends,0);
});

test('launch fee expiry blocks promotion burn before wallet signing',async t=>{
  const f=fixture(t);f.pumpBytes=8;
  f.input.launchServiceQuote.expiresAt=new Date(Date.now()+50_000).toISOString();
  await assert.rejects(submitPumpDevnetLaunch(f.input),/Launch fee quote is too close to expiry/);
  assert.equal(f.preparationComplete,true);assert.equal(f.walletCalls,0);assert.equal(f.sends,0);
});

test('launch rejects conflicting reserve custody identities and keeps Mainnet execution disabled',async t=>{
  const f=fixture(t);let rpcCalls=0;f.input.connection.getGenesisHash=async()=>{rpcCalls++;return SOLANA_GENESIS.devnet;};
  await assert.rejects(submitPumpDevnetLaunch({...f.input,reserveConfig:{...f.input.reserveConfig,authority:String(f.input.payer)}}),/identities must match/);
  await assert.rejects(submitPumpDevnetLaunch({...f.input,feeRouterProgramId:String(f.input.payer)}),/identities must match/);
  await assert.rejects(submitPumpDevnetLaunch({...f.input,cluster:'mainnet-beta'}),/Mainnet coin launching is not enabled/);
  assert.equal(rpcCalls,0);assert.equal(f.walletCalls,0);assert.equal(f.sends,0);
});
