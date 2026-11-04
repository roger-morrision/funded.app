import {Keypair} from '@solana/web3.js';
import nacl from 'tweetnacl';
export function installEphemeralAdminWallet(){
 // Generated inside the isolated browser. No private bytes cross the test API
 // or appear in arguments, traces, storage, screenshots or report artifacts.
 const key=Keypair.generate();window.qaWalletSigns=0;
 window.solana={publicKey:key.publicKey,connect:async()=>{},on:()=>{},signMessage:async message=>({signature:nacl.sign.detached(message,key.secretKey)}),signTransaction:async transaction=>{
  window.qaWalletSigns++;if(window.qaMutateTransfer)transaction.instructions[0].data[4]^=1;
  transaction.partialSign(key);return transaction;
 }};return key.publicKey.toBase58();
}
