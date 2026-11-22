import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {PublicKey,Keypair,TransactionMessage,VersionedTransaction,AddressLookupTableAccount} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID} from '@solana/spl-token';
import bs58 from 'bs58';
import {sellBuilderFixture} from './token-sell-capture-fixture.mjs';
import {buildReviewedUsdcSellConversion} from '../../server/token-conversion-sell.mjs';
import {SOLANA_GENESIS} from '../../solana-network.js';
import {DEVELOPER_TOKEN_LOCK_PERIODS} from '../../developer-lock-period.js';
import {deriveSolCreditV3,deriveTokenConversionV3} from '../../mint-router-v3-token.js';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const disc=name=>createHash('sha256').update('account:'+name).digest().subarray(0,8);
const key=n=>new PublicKey(new Uint8Array(32).fill(n));
const elf=readFileSync(process.env.FUNDED_OFFLINE_PRODUCTION_ELF||'missing-required-public-production-candidate');
assert.equal(elf.length,1110880);assert.equal(sha(elf),'8f6b661e4318be921bc41db86d410d888afc62c851c1e56d60e129ce7bb75bbd');

export function sellProofFixture({category=5,prefund=0,beforeVault=1000}={}){
  const expected=sellBuilderFixture(category),built=buildReviewedUsdcSellConversion(expected),received=14211301n,rent=1000;
  const addresses=[...new Map(built.instruction.keys.map(k=>[String(k.pubkey),k.pubkey])).values()];
  const table=new AddressLookupTableAccount({key:key(90),state:{deactivationSlot:0xffffffffffffffffn,lastExtendedSlot:1,lastExtendedSlotStartIndex:0,addresses}});
  const message=new TransactionMessage({payerKey:expected.authority,recentBlockhash:String(key(91)),instructions:[built.instruction]}).compileToV0Message([table]);
  expected.messageHash=sha(message.serialize());
  const all=message.getAccountKeys({addressLookupTableAccounts:[table]}),keys=Array.from({length:all.length},(_,i)=>String(all.get(i))),at=pubkey=>keys.indexOf(String(pubkey));
  // In-memory fixture signatures only; never submitted or persisted as wallets.
  const signed=new VersionedTransaction(message);signed.sign([Keypair.fromSeed(new Uint8Array(32).fill(33)),Keypair.fromSeed(new Uint8Array(32).fill(34))]);
  const signature=bs58.encode(signed.signatures[0]),index=0;
  const balances=keys.map(()=>0),post=[...balances],vaultIndex=at(built.vault),wsolIndex=at(built.instruction.keys[8].pubkey),tokenIndex=at(built.instruction.keys[7].pubkey);
  balances[vaultIndex]=beforeVault;balances[wsolIndex]=prefund;post[vaultIndex]=beforeVault+Number(received)+prefund+Math.max(0,rent-beforeVault);
  const token=amount=>({accountIndex:tokenIndex,mint:built.quoteMint,owner:String(built.vault),programId:String(TOKEN_PROGRAM_ID),uiTokenAmount:{amount:String(amount),decimals:6}});
  const tx={slot:1000,blockTime:1800000000,transaction:{signatures:signed.signatures.map(signature=>bs58.encode(signature)),message},meta:{err:null,fee:10000,
    preBalances:balances,postBalances:post,preTokenBalances:[token(2000000)],postTokenBalances:[token(1000000)],
    loadedAddresses:message.resolveAddressTableLookups([table]),innerInstructions:[{index,instructions:[
      {programIdIndex:at(expected.pumpSellInstruction.programId),accounts:expected.pumpSellInstruction.keys.map(k=>at(k.pubkey)),data:bs58.encode(expected.pumpSellInstruction.data)},
      {programIdIndex:at(TOKEN_PROGRAM_ID),accounts:[wsolIndex,vaultIndex,vaultIndex],data:bs58.encode(Buffer.from([9]))}]}]}};
  const info=data=>({owner:expected.programId,executable:false,data,lamports:1000});
  const receipt=Buffer.alloc(161);disc('MintTokenConversionV3').copy(receipt);expected.conversionId.copy(receipt,8);expected.mint.toBuffer().copy(receipt,40);
  new PublicKey(built.quoteMint).toBuffer().copy(receipt,72);new PublicKey(built.pool).toBuffer().copy(receipt,104);receipt[136]=category;
  receipt.writeBigUInt64LE(1000000n,137);receipt.writeBigUInt64LE(received,145);receipt.writeBigInt64LE(1800000000n,153);
  const credit=Buffer.alloc(105);disc('MintSolCreditV3').copy(credit);expected.mint.toBuffer().copy(credit,8);credit.writeBigUInt64LE(received,40+category*8);
  const f={expected,built,tx,signature,receiptAccount:info(receipt),creditAccount:info(credit),minimumVaultRent:rent};
  f.parserArgs=()=>({transaction:f.tx,signature:f.signature,expected:f.expected,receiptAccount:f.receiptAccount,creditAccount:f.creditAccount,minimumVaultRent:f.minimumVaultRent});
  const loader=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'),pd=PublicKey.findProgramAddressSync([expected.programId.toBuffer()],loader)[0];
  const programBytes=Buffer.alloc(36);programBytes.writeUInt32LE(2);pd.toBuffer().copy(programBytes,4);
  const pdBytes=Buffer.alloc(45+elf.length);pdBytes.writeUInt32LE(3);pdBytes.writeBigUInt64LE(900n,4);pdBytes[12]=1;key(60).toBuffer().copy(pdBytes,13);elf.copy(pdBytes,45);
  f.programAccount={owner:loader,executable:true,data:programBytes,lamports:1000};f.programData={owner:loader,executable:false,data:pdBytes,lamports:100000};
  // FABRICATED review metadata for unit admission tests ONLY. Never persisted to
  // production config and never evidence of an actual independent release review.
  f.release={schemaVersion:1,cluster:'mainnet-beta',status:'reviewed',assetConfiguration:'onchain-v1',programId:String(expected.programId),
    upgradeAuthority:String(key(60)),fundedMint:'7R4MP6VX7n3RMNhL9zsk5Zu5ibZvwq8npUYnRq7epump',fundedPool:'58XqWPXDGp3GfU9DAFxs8C1GJwTLdHdQhJRofAF5yWTV',
    programDataSha256:sha(pdBytes),sourceRevision:'0278fb68a3eb4cae66115bd61a03c0f91ac46c1b',binary:{bytes:elf.length,sha256:sha(elf)},
    independentReview:{reviewer:'UNIT TEST ONLY',reference:'fabricated local validator fixture; not release acceptance',sourceRevision:'0278fb68a3eb4cae66115bd61a03c0f91ac46c1b',binarySha256:sha(elf)},developerLockPeriodsSeconds:DEVELOPER_TOKEN_LOCK_PERIODS};
  f.connection={getGenesisHash:async()=>SOLANA_GENESIS['mainnet-beta'],
    getAccountInfo:async address=>String(address)===String(expected.programId)?f.programAccount:String(address)===String(pd)?f.programData:null,
    getTransaction:async()=>f.tx,getSignatureStatuses:async()=>({value:[{slot:f.tx.slot,err:null,confirmationStatus:'finalized'}]}),
    getMultipleAccountsInfoAndContext:async(addresses,options)=>{assert.equal(String(addresses[0]),String(deriveTokenConversionV3(expected.programId,expected.mint,expected.conversionId)));assert.equal(String(addresses[1]),String(deriveSolCreditV3(expected.programId,expected.mint)));assert.equal(options.commitment,'finalized');return {context:{slot:1001},value:[f.receiptAccount,f.creditAccount]};},
    getMinimumBalanceForRentExemption:async()=>rent,sendRawTransaction:()=>assert.fail('No financial operation permitted')};
  f.adapterArgs=()=>({connection:f.connection,signature:f.signature,expected:f.expected,release:f.release});
  return f;
}
