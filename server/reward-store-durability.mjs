import {open,stat,realpath} from 'node:fs/promises';
import {dirname} from 'node:path';

export function rewardStoreFailure(errors){
  if(errors.length===1)return errors[0];
  const first=errors[0],error=new AggregateError(errors,errors.map(e=>String(e?.message||e)).join('; '),{cause:first});
  for(const name of ['status','statusCode'])if(Number.isInteger(first?.[name]))error[name]=first[name];
  return error;
}

// Windows cannot provide this directory-descriptor fence through this API.
// Linux failures are never downgraded. Fence the SAME-filesystem ancestor chain,
// including newly created names and paths left by an interrupted prior writer.
// A cross-device mount and existing symlink namespace must be provisioned by ops.
export async function fenceRewardLedgerDirectory(directory){
  if(process.platform==='win32')return;
  let current=await realpath(directory);const device=(await stat(current,{bigint:true})).dev;
  for(;;){
    const handle=await open(current,'r'),errors=[];
    try{await handle.sync();}catch(error){errors.push(error);}
    try{await handle.close();}catch(error){errors.push(error);}
    if(errors.length)throw rewardStoreFailure(errors);
    const parent=dirname(current);if(parent===current)return;
    if((await stat(parent,{bigint:true})).dev!==device)return;
    current=parent;
  }
}
