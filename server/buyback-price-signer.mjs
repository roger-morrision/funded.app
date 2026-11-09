import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {PublicKey} from '@solana/web3.js';
import nacl from 'tweetnacl';
import {DEVNET_GENESIS_HASH} from './automatic-reward-chain.mjs';

export const priceConfigAddress = program => PublicKey.findProgramAddressSync(
  [Buffer.from('buyback-price-signer-v1')], new PublicKey(program))[0];
const discriminator = createHash('sha256').update('account:BuybackPriceConfig').digest().subarray(0,8);

export function buybackPriceService(env=process.env) {
  const key=env.FUNDED_DEVNET_BUYBACK_PRICE_SIGNER, raw=env.FUNDED_DEVNET_BUYBACK_PRICE_SIGNER_URL;
  if(!key||!raw)return null;
  const endpoint=new URL(raw), signer=new PublicKey(key);
  if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.hash||endpoint.search
    ||!PublicKey.isOnCurve(signer.toBytes()))throw Error('Invalid independent Devnet buyback signer configuration.');
  const tokenFile=env.FUNDED_DEVNET_BUYBACK_PRICE_SIGNER_TOKEN_FILE;
  const token=tokenFile?readFileSync(tokenFile,'utf8').trim():null;
  if(token!==null&&!/^[a-f0-9]{64}$/.test(token))throw Error('Invalid price signer authentication file.');
  return {signer,endpoint,token};
}

export async function priceSignerActivated(connection,program,signer) {
  const [genesis,account]=await Promise.all([connection.getGenesisHash(),
    connection.getAccountInfo(priceConfigAddress(program),'finalized')]);
  return genesis===DEVNET_GENESIS_HASH&&account?.owner.equals(new PublicKey(program))===true&&account.data.length===40
    &&account.data.subarray(0,8).equals(discriminator)&&account.data.subarray(8).equals(signer.toBuffer());
}

// The custodian reviews the unsigned transaction using its own market data.
export async function cosignBuyback({connection,transaction,program,service,request=fetch}) {
  const {message}=transaction, signer=service.signer;
  if(message.header.numRequiredSignatures!==2||!message.staticAccountKeys[1].equals(signer)
    ||message.staticAccountKeys[0].equals(signer))throw Error('Unexpected buyback signers.');
  if(!await priceSignerActivated(connection,program,signer))
    throw Error('Independent price signer is not activated on Devnet.');
  const response=await request(service.endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(45000),
    headers:{'content-type':'application/json',...(service.token?{authorization:`Bearer ${service.token}`}:{})},body:JSON.stringify({cluster:'devnet',programId:String(program),
      transaction:Buffer.from(transaction.serialize()).toString('base64')})});
  if(!response.ok)throw Error('The independent price signer declined the buyback.');
  const {signature}=await response.json();
  if(typeof signature!=='string'||signature.length!==88)throw Error('Invalid price signature.');
  const bytes=Buffer.from(signature,'base64');
  if(bytes.length!==64||!nacl.sign.detached.verify(message.serialize(),bytes,signer.toBytes()))throw Error('Invalid price signature.');
  transaction.addSignature(signer,bytes);
}
