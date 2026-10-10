export function referralStatusLabel(state, claimable = 0) {
  return ({disconnected:'Connect wallet', verification:'Sign in to view', cancelled:'Sign-in cancelled', checking:'Checking rewards…', unavailable:'Rewards unavailable', ready:claimable > 0 ? 'Ready to claim' : 'No rewards ready'})[state] || 'Check rewards';
}

export function isReferralSignInCancelled(error) {
  return Number(error?.code) === 4001 || error?.code === 'ACTION_REJECTED'
    || /(?:user.*(?:reject|denied|declined|cancel)|(?:request|signature|sign.?in).*cancel)/i.test(String(error?.message || ''));
}

export function referralClaimStatusLabel(status) {
  return ({'awaiting-wallet-signature':'Ready to review', 'wallet-verified':'Ready to receive', executing:'Payment processing', 'verification-pending':'Checking payment', failed:'Payment needs review', paid:'Paid', expired:'Expired'})[status] || 'Status unavailable';
}
