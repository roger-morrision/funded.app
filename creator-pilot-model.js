const uncertain = new Set(['broadcasting','submitted','unknown','confirmed','verification-pending','registration-pending']);

// Local records help people resume; they never establish chain verification or payouts.
export function creatorPilotProgress({ journal = [], reviewOpened = false, cluster = 'devnet' } = {}) {
  const records = Array.isArray(journal) ? journal.filter(row => row?.cluster === cluster) : [];
  const pending = records.some(row => uncertain.has(row.state));
  const recorded = records.some(row => row.state === 'completed' && row.signature && row.mint);
  return {
    pending,
    primary: pending ? { href:'#my-launches', label:'Check unfinished launch' } : { href:'#launch', label:'Prepare your token' },
    statuses:[
      'Start without a wallet',
      reviewOpened ? 'Review opened this session · check current costs again before signing' : 'Review costs and the fee allocation before signing',
      pending ? 'Unfinished launch recorded · inspect the receipt before retrying' : recorded ? 'Launch recorded locally · verify its receipt' : 'A Devnet wallet and verified route are required',
      'Only finalized receipts establish collected fees or payments',
      'Share verified records in your own community; posting is optional',
    ],
  };
}
