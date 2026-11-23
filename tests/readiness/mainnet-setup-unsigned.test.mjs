import test from 'node:test';
import assert from 'node:assert/strict';
import {VersionedMessage,TransactionMessage,PublicKey} from '@solana/web3.js';
import plan from '../../config/mainnet-deployment-plan.json' with {type:'json'};
import {buildMainnetSetupInventory} from '../../scripts/mainnet-setup-unsigned.mjs';

const ids=plan.selectedPublicIdentities;
const names=['initializeRouter','configureGuard','configurePriceSigner','configurePrimaryAsset'];
const feePayers=Object.fromEntries(names.map(name=>[name,ids.deploymentPayer]));
const blockhash='11111111111111111111111111111111'; // Syntax-only fixture, never a live signing blockhash.

test('fresh selected setup instructions expose the exact signed and writable account geometry',()=>{
  const inventory=buildMainnetSetupInventory({plan,dailyCapLamports:'9000000'});
  assert.deepEqual(inventory.steps.map(step=>step.name),names);
  assert.equal(inventory.programData,'ETH5QpSQrKAqS1y2RDntJzXeTU9D79u1gz8hCUY4zsQT');
  const [router,guard,price,asset]=inventory.steps;
  assert.deepEqual(router.instruction.accounts.map(x=>[x.address,x.signer,x.writable]),[
    [ids.automationOperator,true,true],[ids.adminUpgrade,true,false],
    [guard.instruction.accounts[2].address,false,true],[ids.program,false,false],
    [inventory.programData,false,false],['11111111111111111111111111111111',false,false],
  ]);
  assert.deepEqual(guard.instruction.accounts.map(x=>[x.signer,x.writable]),
    [[true,false],[false,false],[false,true],[false,false],[false,false]]);
  assert.equal(Buffer.from(guard.instruction.dataBase64,'base64').readBigUInt64LE(8),9000000n);
  assert.deepEqual(price.instruction.accounts.map(x=>[x.signer,x.writable]),
    [[true,true],[true,false],[false,false],[false,false],[false,true],[false,false]]);
  assert.deepEqual(asset.instruction.accounts.map(x=>[x.signer,x.writable]),
    [[true,true],[false,false],[false,false],[false,true],[false,true],[false,false],[false,false],[false,false]]);
  assert.equal(asset.instruction.accounts[5].address,ids.primaryMint);
  assert.equal(asset.instruction.accounts[6].address,ids.primaryPool);
  assert.equal(Buffer.from(asset.instruction.dataBase64,'base64').readBigUInt64LE(8),1n);
  assert.equal(Buffer.from(asset.instruction.dataBase64,'base64')[16],0);
  assert.deepEqual(inventory.steps.map(x=>x.expectedRentPayer),[ids.automationOperator,null,ids.adminUpgrade,ids.adminUpgrade]);
  assert.ok(inventory.steps.every(x=>x.message===null));
});

test('missing cap and message inputs remain explicit unresolved work',()=>{
  const inventory=buildMainnetSetupInventory({plan});
  assert.equal(inventory.steps[1].instruction,null);
  assert.equal(inventory.steps[1].status,'missing-reviewed-policy');
  assert.deepEqual(inventory.steps[1].unresolved,['reviewedDailyCapLamports','feePayer','recentBlockhash']);
  assert.ok(inventory.steps.every(x=>x.message===null));
});

test('explicit payers and blockhash create decodable unsigned messages only',()=>{
  const inventory=buildMainnetSetupInventory({plan,dailyCapLamports:'9000000',feePayers,recentBlockhash:blockhash});
  assert.equal(inventory.steps.length,4);
  for(const step of inventory.steps){
    assert.deepEqual(step.unresolved,[]);
    const bytes=Buffer.from(step.message.messageBase64,'base64');
    const message=VersionedMessage.deserialize(bytes);
    const [ix]=TransactionMessage.decompile(message).instructions;
    assert.equal(ix.programId.toBase58(),ids.program);
    assert.equal(ix.data.toString('base64'),step.instruction.dataBase64);
    assert.equal(message.staticAccountKeys[0].toBase58(),ids.deploymentPayer);
    assert.deepEqual(ix.keys.map(key=>[key.pubkey.toBase58(),key.isSigner,key.isWritable]),
      step.instruction.accounts.map(key=>[key.address,key.signer,key.writable]));
    assert.equal(step.message.messageSha256.length,64);
    assert.equal(step.message.feeQuoteLamports,null);
  }
  assert.deepEqual(inventory.steps[0].message.requiredSigners,[ids.deploymentPayer,ids.automationOperator,ids.adminUpgrade]);
  assert.deepEqual(inventory.steps[2].message.requiredSigners,[ids.deploymentPayer,ids.adminUpgrade,ids.priceAttestor]);
});

test('compiled message decoder reflects writable fee payer coalescing',()=>{
  const ownerPayers=Object.fromEntries(names.map(name=>[name,ids.adminUpgrade]));
  const inventory=buildMainnetSetupInventory({plan,dailyCapLamports:'9000000',feePayers:ownerPayers,recentBlockhash:blockhash});
  const guard=inventory.steps[1];
  assert.equal(guard.instruction.accounts[0].writable,false);
  assert.equal(guard.message.instruction.accounts[0].writable,true);
  assert.deepEqual(guard.message.requiredSigners,[ids.adminUpgrade]);
});

test('mismatched identities and invalid reviewed cap fail closed',()=>{
  assert.throws(()=>buildMainnetSetupInventory({plan:{...plan,mainnetProgramId:ids.deploymentPayer}}),/match the public plan/);
  assert.throws(()=>buildMainnetSetupInventory({plan:{...plan,mainnetActivationAuthorized:true}}),/fresh, inactive/);
  for(const cap of ['-1','01','1.5','18446744073709551616',9_000_000])
    assert.throws(()=>buildMainnetSetupInventory({plan,dailyCapLamports:cap}),/reviewed u64 daily cap/);
  assert.throws(()=>buildMainnetSetupInventory({plan,feePayers:{unknown:ids.deploymentPayer}}),/Unknown setup step/);
  assert.throws(()=>buildMainnetSetupInventory({plan,feePayers:{initializeRouter:'bad-key'},recentBlockhash:blockhash}));
  assert.equal(PublicKey.isOnCurve(new PublicKey(ids.priceAttestor).toBytes()),true);
});
