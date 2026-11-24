import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Keypair} from '@solana/web3.js';
import {createMetadataPublisher,verifyPublishedMetadata} from '../server/metadata-publication.mjs';

// Storage acceptance only. Public test metadata contains no wallet secret,
// personal data or production token identity. This never creates a token.
export async function publishMetadataProbe({credentialFile,output,fetchImpl=fetch}){
  assert(typeof credentialFile==='string'&&credentialFile,'An explicit credential file reference is required.');
  await mkdir(output,{recursive:false}); // Refuse to overwrite/retry an earlier upload run.
  const record={mint:Keypair.generate().publicKey.toBase58(),creatorWallet:Keypair.generate().publicKey.toBase58(),
    cluster:'devnet',name:'Funded storage verification',symbol:'VERIFY',imageSha256:'',
    description:'Disposable storage verification fixture. No token was created; no monetary value.'};
  await writeFile(resolve(output,'input.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});
  const publish=createMetadataPublisher({env:{METADATA_STORAGE:'pinata',PINATA_JWT_FILE:credentialFile},fetchImpl,
    onPublished:pinned=>writeFile(resolve(output,'record.json'),JSON.stringify(pinned,null,2)+'\n',{flag:'wx',flush:true})});
  await publish({record});
  return recheckMetadataProbe({file:resolve(output,'record.json'),fetchImpl});
}

export async function recheckMetadataProbe({file,fetchImpl=fetch}){
  const record=JSON.parse(await readFile(file,'utf8'));
  assert(record.cluster==='devnet'&&record.symbol==='VERIFY','A disposable storage probe is required.');
  const publication=await verifyPublishedMetadata(record,{fetchImpl});
  return {schemaVersion:1,scope:'live-public-storage-only',cluster:'devnet',publication,
    checkedAt:new Date().toISOString(),transactionsSigned:0,transactionsSubmitted:0,
    limitation:'Public byte equality and current availability; not a token launch, permanent retention guarantee or financial acceptance.'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const [mode,first,second,...extra]=process.argv.slice(2);
    assert(!extra.length&&first&&((mode==='publish'&&second)||(mode==='verify'&&!second)),
      'Use publish CREDENTIAL_FILE NEW_OUTPUT_DIRECTORY or verify RECORD_FILE.');
    const result=mode==='publish'?await publishMetadataProbe({credentialFile:resolve(first),output:resolve(second)})
      :await recheckMetadataProbe({file:resolve(first)});
    console.log(JSON.stringify(result,null,2));
  }catch{console.error('Metadata storage probe failed. Preserve the output directory; do not repeat uploads blindly. No transaction was created.');process.exitCode=1;}
}
