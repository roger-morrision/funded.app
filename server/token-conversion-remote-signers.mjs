import assert from 'node:assert/strict';
import {PublicKey} from '@solana/web3.js';
import nacl from 'tweetnacl';
import {conversionJson,conversionObject,unsignedConversionHash} from './token-conversion-http.mjs';

// Endpoint/token references are supplied by the trusted runtime, never an HTTP
// conversion request. This does not load custody keys or admit a production role.
export function createTokenConversionRemoteSigner({endpoint,token,publicKey,programId,role,request=fetch}){
  const url=new URL(endpoint),key=new PublicKey(publicKey);
  const internal=url.protocol==='http:'&&/^[a-z][a-z0-9-]{0,62}$/.test(url.hostname)&&url.hostname!=='localhost';
  assert((url.protocol==='https:'||internal)&&!url.username&&!url.password&&!url.hash&&!url.search&&url.pathname==='/',
    'Explicit HTTPS or internal service origin required.');
  assert(typeof token==='string'&&token.length===64&&/^[a-f0-9]{64}$/.test(token)&&['operator','price-attestation'].includes(role),'Dedicated exact-role service authentication required.');
  async function post(path,body,signal){
    try{
      const response=await request(new URL(path,url),{method:'POST',redirect:'error',
        signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000),
        headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});
      if(response.status!==200)throw Error('Refused');
      assert(String(response.headers.get('content-type')).startsWith('application/json'),'JSON response required.');
      return await conversionJson(response.body);
    }catch{throw Error('Conversion custody service result is unconfirmed.');}
  }
  return {publicKey:key,
    async signMessage(args){
      assert(args.role===role&&args.version===0,'Unexpected conversion signing role.');
      const input={cluster:'mainnet-beta',programId:String(programId),transaction:args.transactionBase64},parsed=unsignedConversionHash(input);
      const message=Buffer.from(parsed.tx.message.serialize());
      assert(parsed.messageHash===args.messageHash&&message.equals(Buffer.from(args.message)),'Remote request differs from reviewed wire.');
      assert(String(parsed.tx.message.staticAccountKeys[role==='operator'?0:1])===String(key),'Remote role identity differs.');
      const value=conversionObject(await post('/sign',{schemaVersion:1,messageHash:parsed.messageHash,request:input},args.signal),
        ['schemaVersion','role','publicKey','messageHash','signature']);
      assert(value.role===role&&value.publicKey===String(key)&&value.messageHash===parsed.messageHash
        &&typeof value.signature==='string'&&value.signature.length===88,'Remote signing response identity differs.');
      const signature=Buffer.from(value.signature,'base64');
      assert(signature.length===64&&signature.toString('base64')===value.signature&&nacl.sign.detached.verify(message,signature,key.toBytes()),'Remote signature differs from exact message.');
      return Uint8Array.from(signature);
    },
    async reconcile({messageHash,signature=null}){
      assert(typeof messageHash==='string'&&messageHash.length===64&&/^[a-f0-9]{64}$/.test(messageHash),'Exact reconciliation hash required.');
      const value=conversionObject(await post('/reconcile',{schemaVersion:1,messageHash,signature}),
        ['schemaVersion','status','messageHash','signature','stage','proof']);
      assert(value.messageHash===messageHash&&['settled','reconciliation-pending','released-no-conversion'].includes(value.status),'Remote reconciliation differs.');
      return value;
    },
  };
}
