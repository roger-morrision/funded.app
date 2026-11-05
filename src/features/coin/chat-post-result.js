export function showChatPostResult(data,document=globalThis.document) {
  const form=document.querySelector('#coin-chat-form, #coin-community-form');if(!form)return;
  let status=document.querySelector('#coin-chat-post-result');
  if(!status){status=document.createElement('p');status.id='coin-chat-post-result';status.className='coin-chat-note';status.setAttribute('role','status');form.after(status);}
  const copy={
    'recorded':'Posted to chat and Coin calls.',
    'not-holder':'Chat posted. Only wallets holding this coin are added to Coin calls.',
    'holdings-unavailable':'Chat posted. Your token balance could not be verified, so no call was recorded.',
    'market-unavailable':'Chat posted. A current market cap could not be verified, so no call was recorded.',
    'repeat-call':'Chat posted. Your existing call stays on Coin calls; another call for this coin is allowed after 30 minutes.',
    'rate-limited':'Chat posted. The limit of 10 calls per hour has been reached.',
  };
  status.textContent=copy[data.calloutStatus]||(data.message?.callout?copy.recorded:'Chat posted.');
  if(data.message?.callout||data.calloutStatus==='repeat-call'){const link=document.createElement('a');link.href='#callouts';link.textContent=' View Coin calls →';status.append(link);}
}
