import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,Transaction,SystemProgram} from '@solana/web3.js';
import {createAutomaticRewardChain,finalizedSend} from '../server/automatic-reward-chain.mjs';
import {SOLANA_GENESIS} from '../solana-network.js';

const authority=Keypair.generate(),programId=Keypair.generate().publicKey.toBase58();
function fixture(genesis=SOLANA_GENESIS['mainnet-beta']) {
  const calls=[];
  const connection={getGenesisHash:async()=>{calls.push('genesis');return genesis;},
    getAccountInfo:async()=>{calls.push('account');throw Error('Unexpected account read');},
    getLatestBlockhash:async()=>{calls.push('blockhash');throw Error('Unexpected signing preparation');},
    sendRawTransaction:async()=>{calls.push('send');throw Error('Unexpected broadcast');}};
  return {connection,calls};
}
test('generic reward sender rejects a Mainnet endpoint before preparing or signing a Devnet transaction',async()=>{
  const f=fixture(),transaction=new Transaction().add(SystemProgram.transfer({fromPubkey:authority.publicKey,toPubkey:Keypair.generate().publicKey,lamports:1}));
  await assert.rejects(finalizedSend(f.connection,transaction,[authority]),/selected network/);
  assert.deepEqual(f.calls,['genesis']);assert.equal(transaction.signature,null);
});
test('unreviewed Mainnet reward sender cannot opt into signing with an arbitrary program hash',async()=>{
  const f=fixture();
  await assert.rejects(finalizedSend(f.connection,new Transaction(),[authority],{cluster:'mainnet-beta',programId,expectedProgramDataSha256:'a'.repeat(64)}),/reviewed release/);
  assert.deepEqual(f.calls,[]);
});
test('all reward mutators and receipt inspection bind network before account access',async()=>{
  const f=fixture(),chain=createAutomaticRewardChain({...f,programId,authority,expectedProgramDataSha256:'a'.repeat(64)});
  const mint=Keypair.generate().publicKey.toBase58(),plan={cluster:'devnet',mint};
  for(const call of [()=>chain.ensureVault(mint),()=>chain.ensureCycle(plan),()=>chain.inspectLeaf(plan,{}),
    ()=>chain.submitLeaf(plan,{}),()=>chain.fundSolVault({mint,amount:'1'}),()=>chain.fundTokenVault({mint,asset:mint,amount:'1',decimals:6})])
    await assert.rejects(call(),/selected network/);
  assert.equal(f.calls.length,6);assert(f.calls.every(call=>call==='genesis'));
});
test('foreign plans and unreviewed Mainnet reward configuration fail without RPC or signatures',async()=>{
  const f=fixture(SOLANA_GENESIS.devnet),dev=createAutomaticRewardChain({...f,programId,authority});
  for(const call of [()=>dev.ensureCycle({cluster:'mainnet-beta'}),()=>dev.submitLeaf({cluster:'mainnet-beta'},{}),()=>dev.inspectLeaf({cluster:'mainnet-beta'}, {})])
    await assert.rejects(call(),/different network/);
  const mainnet=createAutomaticRewardChain({...f,programId,authority,cluster:'mainnet-beta',expectedProgramDataSha256:'a'.repeat(64)});
  assert.deepEqual((await mainnet.readiness()).reasons,['program-release-not-reviewed']);
  await assert.rejects(mainnet.ensureVault(programId),/program-release-not-reviewed/);
  assert.deepEqual(f.calls,[]);
});
