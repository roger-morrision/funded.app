export function referralStatusLabel(state, claimable = 0) {
  return ({disconnected:'Connect wallet', verification:'Verify wallet', checking:'Checking rewards…', unavailable:'Rewards unavailable', ready:claimable > 0 ? 'Ready to claim' : 'No rewards ready'})[state] || 'Check rewards';
}

export function referralClaimStatusLabel(status) {
  return ({'awaiting-wallet-signature':'Ready to review', 'wallet-verified':'Ready to receive', executing:'Payment processing', 'verification-pending':'Checking payment', failed:'Payment needs review', paid:'Paid', expired:'Expired'})[status] || 'Status unavailable';
}
