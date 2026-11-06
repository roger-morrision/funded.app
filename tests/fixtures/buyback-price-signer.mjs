import {createHash} from 'node:crypto';
import {Keypair,PublicKey,VersionedTransaction} from '@solana/web3.js';
import nacl from 'tweetnacl';
import {priceConfigAddress} from '../../server/buyback-price-signer.mjs';
import {DEVNET_GENESIS_HASH} from '../../server/automatic-reward-chain.mjs';

export function priceSignerFixture(connection, programId) {
  const signer=Keypair.generate(),read=connection.getAccountInfo?.bind(connection);
  connection.getGenesisHash=async()=>DEVNET_GENESIS_HASH;
  connection.getAccountInfo=async(address,...args)=>address.equals(priceConfigAddress(programId))
    ? {owner:new PublicKey(programId),data:Buffer.concat([createHash('sha256').update('account:BuybackPriceConfig').digest().subarray(0,8),signer.publicKey.toBuffer()])}
    : read?.(address,...args);
  return {env:{FUNDED_DEVNET_BUYBACK_PRICE_SIGNER:signer.publicKey.toBase58(),FUNDED_DEVNET_BUYBACK_PRICE_SIGNER_URL:'https://price.invalid/sign'},
    request:async(_url,{body})=>{
      const tx=VersionedTransaction.deserialize(Buffer.from(JSON.parse(body).transaction,'base64'));
      const signature=nacl.sign.detached(tx.message.serialize(),signer.secretKey);
      return {ok:true,json:async()=>({signature:Buffer.from(signature).toString('base64')})};
    }};
}
