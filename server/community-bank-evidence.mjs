import {PublicKey} from '@solana/web3.js';

const raw=info=>({owner:new PublicKey(info.owner).toBase58(),executable:info.executable,
  lamports:info.lamports??null,dataBase64:Buffer.from(info.data).toString('base64')});

// A split mint/list read remains useful forensic input, but is NOT advertised as
// one bank. Preserve the distinction instead of inferring it from equal supply.
export function communityBankEvidence({source,slot,context,mintKey,mintInfo,addresses,infos,sameBank}){
  return {version:1,source,sameBank,slot,mintContextSlot:sameBank?slot:null,
    readMethod:sameBank?'getMultipleAccountsInfoAndContext':'getAccountInfo+getProgramAccounts',commitment:'finalized',
    observedContext:{...context},
    mint:{address:String(mintKey),account:raw(mintInfo)},
    accounts:addresses.map((address,i)=>({address:String(address),account:raw(infos[i])}))};
}
