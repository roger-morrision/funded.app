import {savedFeeAllocationCopy} from '../fees/fee-policy-copy.js';
import { mountReserveFacts } from './reserve-facts.js';
import { link, el, address, reportContextLink } from './view-utils.js';
export function identityMatches(candidate, launches) {
  const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const name = normalize(candidate.name), symbol = normalize(candidate.symbol);
  return launches.filter(row => row.mint !== candidate.mint && (name && normalize(row.name) === name
    || symbol && normalize(row.symbol) === symbol || candidate.imageUri && row.imageUri === candidate.imageUri)).slice(0, 5);
}
export function initializeLaunchFacts(app) {
  const coin = document.querySelector('#coin-page'); if (!coin) return;
  const root = document.createElement('details'); root.className = 'flow-panel launch-facts';
  root.innerHTML = '<summary>Verified launch facts</summary><p data-facts-status>Waiting for the token’s RPC snapshot.</p><dl></dl><p>Facts describe the checked records. Similar identities are advisory; a paid promotion is not a risk assessment.</p>';
  (coin.querySelector('.coin-main-column') || coin).append(root);
  mountReserveFacts(root,app);
  const report=reportContextLink('Report this coin');root.append(report);
  const reset = () => { root.querySelector('dl').replaceChildren(); root.querySelector('[data-facts-status]').textContent = 'Checking this token’s RPC snapshot…'; };
  window.addEventListener('funded:coin-facts-loading', reset);
  window.addEventListener('funded:coin-facts', event => {
    const { mint, parsedMint, launch, checkedAt, error } = event.detail;
    report.dataset.reportContext=location.href;
    if (mint !== app.getCoinMintAddress()) return;
    const status = root.querySelector('[data-facts-status]');
    if (error) { reset(); status.textContent = 'Current RPC facts unavailable. Refresh the token to retry.'; return; }
    status.textContent = `RPC snapshot · confirmed commitment · checked ${new Date(checkedAt).toLocaleString()}. Saved launch policy is recorded evidence.`;
    const list = root.querySelector('dl'); list.replaceChildren();
    const fact = (label, text, href) => {
      const term = document.createElement('dt'); term.textContent = label;
      const value = document.createElement('dd'); value.textContent = text;
      if (href) { const link = document.createElement('a'); link.href = href; link.textContent = ' Inspect source ↗'; link.target = '_blank'; link.rel = 'noopener noreferrer'; value.append(link); }
      list.append(term, value);
    };
    const explorer = `https://explorer.solana.com/address/${mint}?cluster=devnet`;
    fact('Mint authority', Object.hasOwn(parsedMint, 'mintAuthority') ? parsedMint.mintAuthority || 'Revoked' : 'Unavailable', explorer);
    fact('Freeze authority', Object.hasOwn(parsedMint, 'freezeAuthority') ? parsedMint.freezeAuthority || 'Revoked' : 'Unavailable', explorer);
    const shares = launch?.feeDistribution?.creatorDirected?.shares;
    fact('Saved fee routing', launch?.onchainVerified && shares ? `${shares.creatorWalletPercent}% creator · ${shares.holderAirdropPercent}% holders · ${shares.solClaimPercent}% X · ${savedFeeAllocationCopy(launch.feeDistribution)}` : 'Verified saved policy unavailable', `/api/launches`);
    fact('Community reserve custody', 'Inspect reserve funding, vault and claim evidence separately. A launch allocation does not prove custody.', '/api/airdrops/reserves');
    fact('Creator provenance', launch?.onchainVerified ? `Recorded launch wallet: ${launch.creatorWallet}. Wallet identity does not imply an X endorsement.` : 'Verified launch wallet unavailable', explorer);
    const matches = identityMatches({ ...launch, mint }, app.verifiedLaunchPolicies);
    fact('Similar launch identities', matches.length ? `${matches.length} listed launch(es) share a normalized name, ticker, or exact image URI. Check full mint addresses.` : 'No exact normalized name, ticker, or image-URI match in the loaded registry. Image content and off-platform coins are not checked.');
    for(const match of matches.filter(row=>address(row.mint))){const term=el('dt',match.name||match.symbol||'Similar identity'),value=el('dd');value.append(link(match.mint,`/token/${match.mint}`));list.append(term,value);}
    fact('Early buyer concentration','Unavailable from the loaded mint snapshot. No concentration or reputation score is inferred.');
  });
  const name = document.querySelector('#token-name'), symbol = document.querySelector('#token-symbol');
  const warning = document.createElement('p'); warning.className = 'flow-note'; warning.setAttribute('role', 'status'); symbol?.closest('label')?.after(warning);
  const sync = () => { const matches = identityMatches({ name:name?.value, symbol:symbol?.value }, app.verifiedLaunchPolicies); warning.textContent = matches.length ? 'Similar name or ticker already appears in the loaded launch directory. Review those full mint addresses; this is advisory and does not block your launch.' : '';for(const match of matches.filter(row=>address(row.mint)))warning.append(el('br'),link(`${match.name||match.symbol||'Listed token'} · ${match.mint}`,`/token/${match.mint}`)); };
  name?.addEventListener('input', sync); symbol?.addEventListener('input', sync);
}
