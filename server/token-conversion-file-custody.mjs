import assert from 'node:assert/strict';
import {constants} from 'node:fs';
import {open,realpath} from 'node:fs/promises';
import {isAbsolute,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {Keypair,PublicKey,VersionedTransaction} from '@solana/web3.js';
import nacl from 'tweetnacl';
import {decodeTokenConversionIntent} from './token-conversion-sell.mjs';

// Private resolver for prepareTokenConversionRuntime.loadCustody. It exposes no
// HTTP listener and supplies one role only, after that runtime's review/journal
// admission. File possession is not release approval or financial acceptance.
export function createFileTokenConversionCustody({role,reference,publicKey,programId,keyFile}){
  assert(['operator','price-attestation'].includes(role),'Exact custody role required.');
  assert(typeof reference==='string'&&/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/.test(reference),'Opaque custody reference required.');
  publicKey=new PublicKey(publicKey).toBase58();programId=new PublicKey(programId).toBase58();
  assert(isAbsolute(keyFile)&&resolve(keyFile)===keyFile,'Absolute canonical custody path required.');
  let pending,secret,closed=false;
  async function load(){
    let file,raw,decoded,key;
    try{
      assert(process.platform==='linux'&&Number.isInteger(constants.O_NOFOLLOW));
      assert(await realpath(keyFile)===keyFile);
      file=await open(keyFile,constants.O_RDONLY|constants.O_NOFOLLOW);
      const stat=await file.stat();
      assert(stat.isFile()&&stat.nlink===1&&stat.uid===process.geteuid()
        &&(stat.mode&0o777)===0o400&&stat.size>0&&stat.size<=512);
      raw=Buffer.alloc(513);const {bytesRead}=await file.read(raw,0,raw.length,0);
      assert(bytesRead===stat.size);decoded=JSON.parse(raw.subarray(0,bytesRead).toString('utf8'));
      assert(Array.isArray(decoded)&&decoded.length===64&&decoded.every(v=>Number.isInteger(v)&&v>=0&&v<=255));
      key=Keypair.fromSecretKey(Uint8Array.from(decoded));assert.equal(key.publicKey.toBase58(),publicKey);
      assert(!closed);secret=Uint8Array.from(key.secretKey);
      return Object.freeze({publicKey,signMessage:async args=>{
        try{
          assert(!closed&&secret&&args?.role===role&&args.version===0&&args.signal instanceof AbortSignal&&!args.signal.aborted);
          assert(args.message instanceof Uint8Array&&args.message.length>0&&args.message.length<=1232);
          assert(/^[a-f0-9]{64}$/.test(args.intentDigest||'')&&/^[a-f0-9]{64}$/.test(args.messageHash||''));
          assert(typeof args.transactionBase64==='string'&&args.transactionBase64.length<=1644);
          const wire=Buffer.from(args.transactionBase64,'base64');assert(wire.length<=1232&&wire.toString('base64')===args.transactionBase64);
          const tx=VersionedTransaction.deserialize(wire),message=Buffer.from(tx.message.serialize());
          assert(tx.message.version===0&&tx.message.header.numRequiredSignatures===2&&tx.signatures.every(s=>s.every(v=>v===0)));
          assert(tx.message.staticAccountKeys[role==='operator'?0:1].toBase58()===publicKey
            &&!tx.message.staticAccountKeys[0].equals(tx.message.staticAccountKeys[1]));
          assert(message.equals(Buffer.from(args.message))&&createHash('sha256').update(message).digest('hex')===args.messageHash);
          const instruction=tx.message.compiledInstructions.at(-1);
          assert(instruction?.accountKeyIndexes.length===41&&tx.message.staticAccountKeys[instruction.programIdIndex]?.toBase58()===programId);
          decodeTokenConversionIntent(instruction.data);
          // The parent runtime has already independently reviewed the complete
          // policy and durably claimed this attempt before calling the resolver.
          return nacl.sign.detached(message,secret);
        }catch{throw Error('Custody refused the exact role/message request.');}
      }});
    }catch{throw Error('Private role custody is unavailable or incompatible.');}
    finally{raw?.fill(0);decoded?.fill?.(0);key?.secretKey.fill(0);await file?.close();}
  }
  const resolver=async(requested,expected)=>{
    assert(!closed&&requested===reference&&expected?.role===role&&expected.publicKey===publicKey,'Custody reference or role differs.');
    // A failed read is latched; replacing a key file cannot turn a retry into
    // automatic custody admission. A new trusted runtime must be prepared.
    pending??=load();return pending;
  };
  resolver.close=async()=>{closed=true;try{await pending;}catch{}secret?.fill(0);secret=undefined;};
  return resolver;
}
