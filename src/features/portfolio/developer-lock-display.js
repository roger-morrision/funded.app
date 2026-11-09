import {formatTokenBaseAmount} from '../../../trade-panel-balance.js';

export function developerLockDisplay(lock, now=Date.now()) {
  const validTime=Number.isSafeInteger(lock?.unlockAt)&&lock.unlockAt>0&&lock.unlockAt<=8640000000000;
  const deadline=validTime?new Date(lock.unlockAt*1000):null;
  const minutes=deadline?Math.max(0,Math.ceil((deadline.getTime()-now)/60000)):null;
  const rawAmount=/^\d+$/.test(String(lock?.amount))&&Number.isInteger(lock.decimals)&&lock.decimals>=0&&lock.decimals<=18
    ?formatTokenBaseAmount(lock.amount,lock.decimals,Math.min(lock.decimals,6)):null;
  const parts=rawAmount?.split('.');
  const amount=parts?`${BigInt(parts[0]).toLocaleString()}${parts[1]?'.'+parts[1]:''}`:null;
  const status=lock?.verified===true?lock.status:'unavailable';
  const automatic=lock?.automaticRelease?.enabled===true;
  return {amount,deadline,
    remaining:status==='released'?'—':status==='claimable'?(automatic?'Awaiting transfer':'Available now'):minutes>0?`${Math.floor(minutes/60)}h ${minutes%60}m`:deadline?'Verify status':'—',
    release:deadline?new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'long'}).format(deadline):'Release time unavailable',
    state:status==='released'?'Released':status==='claimable'?(automatic?'Awaiting automatic transfer':'Ready to release'):status==='locked'?'Locked':'Verification unavailable',
    timing:status==='released'?'Tokens have been transferred to the original creator wallet.':status==='claimable'?(automatic
      ?`Tokens unlock automatically to the original creator wallet after network confirmation.${lock.automaticRelease.healthy?' No wallet signature is needed.':' Automatic delivery is delayed; the service will retry.'}`
      :'Automatic delivery is unavailable. Open the token page for manual release.')
      :minutes>0?`About ${Math.floor(minutes/60)}h ${minutes%60}m remaining. ${automatic?'Tokens will transfer automatically to the original creator wallet after unlock and network confirmation.':'Refresh to check automatic delivery status.'}`
        :deadline?'Deadline reached. Refresh to verify the automatic transfer status.':'Refresh to verify the saved release time.'};
}

export function walletDeveloperLocks(launches,wallet,cluster) {
  return wallet?(launches||[]).filter(row=>row.onchainVerified===true&&row.cluster===cluster&&row.creatorWallet===wallet
    &&row.developerTokenLock?.verified===true&&/^[1-9]\d*$/.test(row.developerTokenLock.amount||'')):[];
}
