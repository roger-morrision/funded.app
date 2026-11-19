export function networkDisclosure(cluster, readOnly = false) {
  if (cluster === 'devnet') return { label:`DEVNET · test SOL${readOnly ? ' · read only' : ''}`, detail:`Test SOL and test tokens have no monetary value.${readOnly ? ' Transaction signing is disabled in this preview.' : ''}` };
  if (cluster === 'mainnet-beta') return readOnly
    ? { label:'MAINNET · read only', detail:'Mainnet data is shown. Transaction signing is disabled in this preview.' }
    : { label:'MAINNET · real SOL', detail:'Transactions use real SOL and tokens. Verify the network, mint and quote before signing.' };
  return { label:'Network unavailable', detail:'Do not sign until the network is verified.' };
}
export function mountNetworkDisclosure({ cluster, readOnly }, document = globalThis.document) {
  const copy = networkDisclosure(cluster,readOnly);
  if (!document.getElementById('network-disclosure')) {
    const badge = document.createElement('a');
    badge.id = 'network-disclosure'; badge.className = 'network-disclosure'; badge.href = '#profile';
    badge.textContent = copy.label; badge.title = copy.detail; badge.setAttribute('aria-label',`${copy.label}. ${copy.detail}`);
    document.querySelector('.top-actions')?.prepend(badge);
  }
  if (!document.getElementById('network-and-rewards-help')) {
    const help = document.createElement('section'); help.id = 'network-and-rewards-help'; help.className = 'panel network-rewards-help';
    const heading = document.createElement('h2'); heading.textContent = 'Network, rewards and promotion';
    const body = document.createElement('p');
    body.textContent = `${copy.label}. ${copy.detail} Allocated rewards are accounting entries. Claimable rewards require eligibility and available funding. Paid rewards require a finalized transaction receipt. Promoted placement is not an endorsement.`;
    const brand = document.createElement('p');
    brand.textContent = globalThis.location?.hostname === 'funded.vip'
      ? 'You are viewing the richpad.fun product at funded.vip. Verify the domain and token mint before connecting a wallet.'
      : 'richpad.fun is the product name shown here. Verify the domain and token mint before connecting a wallet.';
    help.append(heading,body,brand); document.getElementById('profile')?.append(help);
  }
  for (const parent of [document.querySelector('.hero-copy-column'),document.getElementById('payments')]) {
    if (!parent || parent.querySelector('.network-rewards-note')) continue;
    const note = document.createElement('p'); note.className = 'network-rewards-note';
    note.textContent = 'Allocated or claimable rewards are not paid rewards. Paid totals require finalized receipts. Promoted placement is not an endorsement. ';
    const link = document.createElement('a'); link.href = '#profile'; link.textContent = 'Network and reward details';
    note.append(link); parent.append(note);
  }
}
