import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,PublicKey} from '@solana/web3.js';
import {createHash} from 'node:crypto';
import {reviewedMainnetManifest} from '../../mainnet-program.js';
import {priceReviewNetwork} from '../../server/price-review-network.mjs';
import {buildAgencyPromotionV3Instruction} from '../../agency-mint-router-v3.js';
import {buildProtectedMintV3ApprovalInstruction, buildProtectedMintV3DisbursementInstruction} from '../../protected-mint-router-v3.js';
import {deriveFeeRouter} from '../../fee-router.js';
import {mainnetReleaseVerified} from '../../server/mainnet-program.mjs';

// Fabricated review metadata for validator unit tests only. This fixture is
// never written to release configuration or used to enable network signing.
const key=()=>String(Keypair.generate().publicKey);
function release(){return {schemaVersion:1,cluster:'mainnet-beta',status:'reviewed',assetConfiguration:'onchain-v1',
  programId:key(),upgradeAuthority:key(),fundedMint:key(),fundedPool:key(),programDataSha256:'a'.repeat(64),
  sourceRevision:'b'.repeat(40),binary:{bytes:1000,sha256:'c'.repeat(64)},
  independentReview:{reviewer:'unit-test fixture',reference:'test-only',sourceRevision:'b'.repeat(40),binarySha256:'c'.repeat(64)},
  developerLockPeriodsSeconds:[21600,43200,86400,172800]};}
test('committed incomplete production release remains disabled',()=>assert.equal(reviewedMainnetManifest(),null));
test('release validation rejects stale reviews and nonproduction identities',()=>{
  const valid=release();assert.equal(reviewedMainnetManifest(valid),valid);
  const mutations=[r=>{r.independentReview.binarySha256='d'.repeat(64);},r=>{r.independentReview.sourceRevision='d'.repeat(40);},
    r=>{r.programId='3qbR1eZRqXUWroWKKYhbDmR3FfqTHfqSU8zZSxtANzYh';},r=>{r.fundedMint=r.fundedPool;},
    r=>{r.cluster='devnet';},r=>{r.developerLockPeriodsSeconds.push(300);},r=>{r.programDataSha256=null;}];
  for(const mutate of mutations){const copy=structuredClone(valid);mutate(copy);assert.equal(reviewedMainnetManifest(copy),null);}
});
test('price review binds network, deployed program and on-chain asset configuration ABI',()=>{
  const r=release(),config={cluster:r.cluster,programId:r.programId,programDataSha256:r.programDataSha256,
    upgradeAuthority:r.upgradeAuthority,assetConfiguration:r.assetConfiguration},request={cluster:r.cluster,programId:r.programId};
  assert.equal(priceReviewNetwork(config,request,{release:r}).cluster,'mainnet-beta');
  for(const field of ['programId','programDataSha256','upgradeAuthority','assetConfiguration'])
    assert.throws(()=>priceReviewNetwork({...config,[field]:key()},request,{release:r}));
  assert.throws(()=>priceReviewNetwork(config,{...request,cluster:'devnet'},{release:r}));
  assert.throws(()=>priceReviewNetwork(config,request,{release:null}));
});
test('promotion builder supplies writable Mainnet guard and preserves Devnet flags',()=>{
  const input={programId:key(),mint:key(),authority:key(),promotionRecipient:key(),postId:1,
    deliveryHash:Buffer.alloc(32,1),sequence:0,amount:100,postedAt:1_800_000_000};
  assert.equal(buildAgencyPromotionV3Instruction({...input,cluster:'mainnet-beta'}).instruction.keys[2].isWritable,true);
  assert.equal(buildAgencyPromotionV3Instruction(input).instruction.keys[2].isWritable,false);
});
test('protected operations approval and payout bind the same terms and writable spending guard', () => {
  const input = { programId:key(), authority:key(), creator:key(), mint:key(), recipient:key(),
    withdrawalId:Buffer.alloc(32, 3), amount:63n, category:1, beneficiary:3 };
  const { instruction:approve, approval } = buildProtectedMintV3ApprovalInstruction(input);
  const { instruction:pay } = buildProtectedMintV3DisbursementInstruction(input);
  for (const ix of [approve, pay]) {
    assert(ix.keys[1].pubkey.equals(new PublicKey(input.creator)) && ix.keys[1].isSigner);
    assert(ix.keys[3].pubkey.equals(deriveFeeRouter(input.programId).address));
    assert.deepEqual(ix.data.subarray(8, 40), input.withdrawalId);
    assert.deepEqual([...ix.data.subarray(40, 42)], [1, 3]);
    assert.equal(ix.data.readBigUInt64LE(42), input.amount);
  }
  assert.equal(approve.keys[3].isWritable, false);
  assert.equal(pay.keys[3].isWritable, true);
  assert(approve.keys[5].pubkey.equals(new PublicKey(input.recipient)));
  assert(pay.keys[6].pubkey.equals(approve.keys[5].pubkey));
  assert(approve.keys[6].pubkey.equals(approval) && pay.keys[7].pubkey.equals(approval));
});
test('runtime trust verifies loader, canonical ProgramData, owner, exact ELF and trailing bytes',()=>{
  const r=release(),loader=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
  const program=new PublicKey(r.programId),pda=PublicKey.findProgramAddressSync([program.toBuffer()],loader)[0];
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  const elf=Buffer.from([127,69,76,70,1,2,3,4]);
  r.binary={bytes:elf.length,sha256:sha(elf)};r.independentReview.binarySha256=sha(elf);
  const data=Buffer.alloc(45+elf.length+4);data.writeUInt32LE(3);data[12]=1;
  new PublicKey(r.upgradeAuthority).toBuffer().copy(data,13);elf.copy(data,45);
  r.programDataSha256=sha(data);
  const programBytes=Buffer.alloc(36);programBytes.writeUInt32LE(2);pda.toBuffer().copy(programBytes,4);
  const evidence={account:{executable:true,owner:loader,data:programBytes},
    programData:{executable:false,owner:loader,data},programDataAddress:String(pda),sha256:sha(data)};
  const verify=(e,manifest=r)=>mainnetReleaseVerified(e,r.programId,manifest.programDataSha256,manifest);
  assert.equal(verify(evidence),true);
  assert.equal(verify({...evidence,account:{...evidence.account,executable:false}}),false);
  assert.equal(verify({...evidence,programDataAddress:key()}),false);
  assert.equal(verify({...evidence,programData:{...evidence.programData,owner:program}}),false);
  for(const offset of [12,13,45,data.length-1]){
    const tampered=Buffer.from(data);tampered[offset]^=1;
    const e={...evidence,programData:{...evidence.programData,data:tampered},sha256:sha(tampered)};
    // Even if an attacker supplies the new data hash, immutable ELF/authority
    // and zero-padding checks still reject the changed payload.
    assert.equal(verify(e,{...r,programDataSha256:sha(tampered)}),false);
  }
});
