import {Keypair,PublicKey} from '@solana/web3.js';
import {readFileSync} from 'node:fs';
import bs58 from 'bs58';
const address=value=>{try{return new PublicKey(value).toBase58();}catch{return null;}};
export function createAdminWallets({env,keeperKeypair,v3AuthorityKeypair,referralPayoutKeypair}){
  const getters=[['Pump fee keeper',keeperKeypair],['V3 router authority',v3AuthorityKeypair],['Referral payout funder',referralPayoutKeypair]];
  function signers(){const result=new Map();for(const[role,get]of getters){try{const key=get?.();if(key?.secretKey&&key.publicKey)result.set(key.publicKey.toBase58(),{role,key,operational:true});}catch{}}
    for(const[role,variable,expected]of [
      ['V3 Operations & marketing','FUNDED_ADMIN_OPERATIONS_SIGNER_FILE',env.FUNDED_V3_OPERATIONS_RECIPIENT],
      ['Protocol operations treasury','FUNDED_ADMIN_PUMP_REVENUE_SIGNER_FILE',env.FUNDED_PUMP_REVENUE_WALLET],
      ['Trading fee treasury','FUNDED_ADMIN_TRADE_FEE_SIGNER_FILE',env.FUNDED_TRADE_FEE_OWNER||env.VITE_FUNDED_TRADE_FEE_OWNER],
      ['Launch service fee treasury','FUNDED_ADMIN_SERVICE_FEE_SIGNER_FILE',env.FUNDED_SERVICE_FEE_RECIPIENT],
      ['Boost payment wallet','FUNDED_ADMIN_BOOST_SIGNER_FILE',env.FUNDED_BOOST_PAYMENT_WALLET]]){
      if(!env[variable]||!expected)continue;
      try{const raw=readFileSync(env[variable],'utf8').trim(),key=Keypair.fromSecretKey(raw.startsWith('[')?Uint8Array.from(JSON.parse(raw)):bs58.decode(raw));
        if(key.publicKey.toBase58()===expected)result.set(expected,{role,key,operational:result.get(expected)?.operational||false});}catch{/* No signer capability on missing or mismatched credentials. */}
    }return result;
  }
  return{
    signerFor:source=>signers().get(source)?.key||null,
    roles:()=>{
      const keys=signers(),rows=new Map([...keys].map(([value,{role}])=>[value,{role,address:value}]));
      for(const[role,value]of [['Protocol operations treasury',env.FUNDED_PUMP_REVENUE_WALLET],['V3 Operations & marketing',env.FUNDED_V3_OPERATIONS_RECIPIENT],
        ['Trading fee treasury',env.FUNDED_TRADE_FEE_OWNER||env.VITE_FUNDED_TRADE_FEE_OWNER],['Launch service fee treasury',env.FUNDED_SERVICE_FEE_RECIPIENT],['Boost payment wallet',env.FUNDED_BOOST_PAYMENT_WALLET]]){
        const key=address(value);if(!key)continue;
        if(rows.has(key))rows.get(key).role+=' / '+role;else rows.set(key,{role,address:key});
      }
      return [...rows.values()].map(row=>({...row,custody:keys.has(row.address)?'server signer':'external wallet',withdrawable:true,
        reserveFloorLamports:keys.get(row.address)?.operational?'100000000':'20000000',
        signingMode:keys.has(row.address)?'server':'wallet',note:keys.has(row.address)?'Admin email approval; server signs this source.':'Source wallet signature required.'}));
    }
  };
}
