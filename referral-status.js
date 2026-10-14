export function referralStatusLabel(state) {
  return ({disconnected:'Connect wallet', verification:'Sign in to view', cancelled:'Sign-in cancelled', checking:'Checking rewards…', unavailable:'Rewards unavailable', recorded:'Payouts recorded', ready:'No payouts recorded'})[state] || 'Check rewards';
}

export function isReferralSignInCancelled(error) {
  return Number(error?.code) === 4001 || error?.code === 'ACTION_REJECTED'
    || /(?:user.*(?:reject|denied|declined|cancel)|(?:request|signature|sign.?in).*cancel)/i.test(String(error?.message || ''));
}

export function referralClaimStatusLabel(status) {
  return ({'awaiting-wallet-signature':'Ready to review', 'wallet-verified':'Ready to receive', executing:'Payment processing', 'verification-pending':'Checking payment', failed:'Payment needs review', paid:'Paid', expired:'Expired'})[status] || 'Status unavailable';
}
