// A zero-balance SOL address cannot receive a sub-rent transfer on its own.
// Keep the immutable entitlement pending instead of sending a failing payout.
export async function requireNativeRewardRecipient(connection,recipient,amount,balance){
 if(!Number.isSafeInteger(balance)||balance<0)throw Error('A verified recipient balance is required.');
 if(balance>0)return;
 const minimum=await connection.getMinimumBalanceForRentExemption(0,'finalized');
 if(!Number.isSafeInteger(minimum)||minimum<0)throw Error('The current native-account minimum is unavailable.');
 if(BigInt(amount)>=BigInt(minimum))return;
 throw Object.assign(Error('The recipient wallet needs SOL funding before this small reward can be sent.'),{
  code:'RECIPIENT_RENT_REQUIRED',statusCode:409,recipient:String(recipient),minimumFundingLamports:String(minimum),
 });
}

export function nativeRecipientFundingPending(error){
 if(error?.code!=='RECIPIENT_RENT_REQUIRED'||!/^\d+$/.test(error.minimumFundingLamports||''))return null;
 return{status:'awaiting-recipient-funding',reason:error.message,minimumFundingLamports:error.minimumFundingLamports};
}
