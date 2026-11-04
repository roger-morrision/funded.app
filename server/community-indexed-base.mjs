import {PublicKey} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID} from '@solana/spl-token';

// The index supplies addresses only. Eligibility balances and mint supply must
// come from one finalized bank; partial pagination can never establish coverage.
export async function readIndexedCommunityBase({connection,mintKey,fetchImpl=fetch}) {
  if(typeof connection.rpcEndpoint!=='string')return null;
  const endpoint=new URL(connection.rpcEndpoint);
  if(!['http:','https:'].includes(endpoint.protocol))throw new Error('Invalid holder index RPC');
  const addresses=new Map();let mintField='mint';
  for(let page=1;page<=10;page++){
    const request=()=>fetchImpl(endpoint.href,{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getTokenAccounts',params:{[mintField]:mintKey.toBase58(),page,limit:1000,displayOptions:{}}}),
      signal:AbortSignal.timeout(15000)});
    let response=await request();if(!response.ok)throw new Error(`Indexed community RPC HTTP ${response.status}`);
    let payload=await response.json();
    if(mintField==='mint'&&payload.error?.code===-32602&&/unknown field [`'"]?mint[`'"]?[, ]/i.test(payload.error.message)
      &&/\bmintAddress\b/.test(payload.error.message)){
      mintField='mintAddress';response=await request();if(!response.ok)throw new Error(`Indexed community RPC HTTP ${response.status}`);
      payload=await response.json();
    }
    if(payload.error)throw new Error(`Indexed community RPC error ${payload.error.code}`);
    const rows=payload.result?.token_accounts;if(!Array.isArray(rows))throw new Error('Missing indexed community account list');
    const before=addresses.size;
    for(const row of rows){const key=new PublicKey(row.address);addresses.set(key.toBase58(),key);}
    if(addresses.size>99)throw new Error('Community holder set exceeds one atomic account read');
    if(rows.length&&addresses.size===before)throw new Error('Community account pagination repeated');
    if(!rows.length||rows.length<1000||payload.result.total===addresses.size)break;
    if(page===10)throw new Error('Community account pagination is incomplete');
  }
  if(!addresses.size)throw new Error('Indexed community holder set is empty');
  const keys=[...addresses.values()],view=await connection.getMultipleAccountsInfoAndContext([mintKey,...keys],{commitment:'finalized'});
  if(!Number.isSafeInteger(view?.context?.slot)||view.context.slot<1||view.value?.length!==keys.length+1)
    throw new Error('Community account context is incomplete');
  const mint=view.value[0],bytes=Buffer.from(mint?.data||[]);
  if(![TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID].some(program=>mint?.owner.equals(program))||bytes.length<82
    ||bytes.readUInt32LE(0)!==0||bytes[45]!==1)throw new Error('Eligibility mint authority must be disabled on an initialized supported mint');
  const supply=bytes.readBigUInt64LE(36);if(supply===0n)throw new Error('Eligibility supply is empty');
  const accounts=view.value.slice(1).map((info,index)=>{
    const data=Buffer.from(info?.data||[]);
    if(!info?.owner.equals(mint.owner)||data.length<165||data[108]===0||!new PublicKey(data.subarray(0,32)).equals(mintKey))
      throw new Error('Indexed community account identity is invalid');
    return{account:keys[index].toBase58(),wallet:new PublicKey(data.subarray(32,64)).toBase58(),balance:data.readBigUInt64LE(64)};
  });
  if(accounts.reduce((sum,row)=>sum+row.balance,0n)!==supply)throw new Error('Indexed community accounts do not cover the full fixed supply');
  return{slot:view.context.slot,accounts,supply};
}
