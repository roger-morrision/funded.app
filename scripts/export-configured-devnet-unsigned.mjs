import {mock} from 'node:test';
import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {configuredFixture} from '../tests/readiness/configured-devnet-fixture.mjs';

// Public deterministic fixture export only. The required retained ELF/account
// inputs are validated by configuredFixture. No service, wallet or RPC is used.
if(process.argv.length!==3)throw Error('Usage: export-configured-devnet-unsigned.mjs output.json');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
try{
  const entries=[];
  for(const revision of ['1','2']){
    const f=configuredFixture({mock},{revision});
    for(const agency of [false,true]){
      const fixture=agency?f.build(revision,{agency}):f.current;
      const {transaction,built,buy,table,assets}=fixture;
      if(!transaction.signatures.every(bytes=>bytes.every(byte=>byte===0)))throw Error('Fixture must remain unsigned.');
      entries.push({revision,variant:agency?'agency-wire-only':'protected-full-review-proof-fixture',
        programId:f.context.programId,contextHash:f.context.contextHash,mint:String(assets.mint),market:String(assets.pool),
        instructionBytes:built.instruction.data.length,instructionHex:built.instruction.data.toString('hex'),
        transactionBase64:Buffer.from(transaction.serialize()).toString('base64'),
        messageSha256:sha(transaction.message.serialize()),wireBytes:transaction.serialize().length,
        signerCount:transaction.signatures.length,allSignaturesZero:true,
        lookupTable:{address:String(table.key),addresses:table.state.addresses.map(String)},
        marketInstruction:{programId:String(buy.programId),dataHex:buy.data.toString('hex')},
        accountMetas:built.instruction.keys.map(k=>({address:String(k.pubkey),signer:k.isSigner,writable:k.isWritable}))});
    }
  }
  await writeFile(process.argv[2],JSON.stringify({schemaVersion:1,scope:'local-only unsigned deterministic fixtures; financial accounts, quote and finalized RPC are mocked; authentic program/config snapshot binding only',
    signingAllowed:false,deploymentAllowed:false,entries},null,2)+'\n',{flag:'wx'});
  console.log('Exported four public unsigned fixtures; no signing, RPC or financial operation.');
}finally{mock.restoreAll();}
