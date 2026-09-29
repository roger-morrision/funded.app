import { EXPLORE_CLUSTER } from './app-config.js';
import { formatXClaimSol, summarizeXClaims } from './x-claim-summary.js';

const root = document.querySelector('[data-personal-rewards]');
const creatorRewardCard = root?.querySelector('[data-creator-rewards]');
const xRewardCard = root?.querySelector('[data-x-rewards]');
const LAMPORTS = 1_000_000_000n;
let refreshId = 0;

function formatSol(lamports) {
  const whole = lamports / LAMPORTS;
  const fraction = (lamports % LAMPORTS).toString().padStart(9, '0').replace(/0+$/, '');
  return `${whole}${fraction ? `.${fraction}` : ''} SOL`;
}

function asLamports(value) {
  if (!/^(0|[1-9]\d*)$/.test(String(value))) throw new Error('Invalid reward amount');
  return BigInt(value);
}

async function getJson(path) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`Rewards unavailable (${response.status})`);
  return response.json();
}

function setCard(card, { unclaimed = '—', claimed = '—', note = '' }) {
  card.querySelector('[data-creator-unclaimed], [data-x-unclaimed]').textContent = unclaimed;
  card.querySelector('[data-creator-claimed], [data-x-claimed]').textContent = claimed;
  card.querySelector('[data-creator-note], [data-x-note]').textContent = note;
}

async function refreshCreator(card, walletAddress, current) {
  try {
    const launches = await getJson('/api/launches');
    if (!Array.isArray(launches)) throw new Error('Launch registry unavailable');
    const mine = launches.filter(launch => launch.onchainVerified === true && launch.cluster === EXPLORE_CLUSTER
      && launch.creatorWallet === walletAddress && launch.pumpFeeRoute?.scope === 'per-mint-v2' && launch.mint);
    if (!mine.length) {
      if (current()) setCard(card, { unclaimed: '0 SOL', claimed: '0 SOL', note: 'No verified creator fee routes for this wallet.' });
      return;
    }
    const activities = await Promise.all(mine.map(launch => getJson(`/api/tokens/${encodeURIComponent(launch.mint)}/fee-activity`)));
    let unclaimed = 0n, claimed = 0n, readyToRequest = 0n;
    const rows = [];
    for (let index = 0; index < mine.length; index += 1) {
      const overview = activities[index]?.overview;
      if (!overview?.available || overview.creatorWallet !== walletAddress) throw new Error('Creator fee evidence unavailable');
      const creator = overview.receivers?.find(row => row.id === 'creator' && row.recipient === walletAddress);
      if (!creator || !overview.creatorClaim) throw new Error('Creator fee evidence incomplete');
      unclaimed += asLamports(creator.withoutConfirmedPayoutLamports);
      claimed += asLamports(creator.confirmedPaidLamports);
      readyToRequest += asLamports(overview.creatorClaim.claimableLamports);
      rows.push({mint:mine[index].mint,name:mine[index].symbol || mine[index].name || mine[index].mint.slice(0,8),unclaimed:formatSol(asLamports(creator.withoutConfirmedPayoutLamports)),available:formatSol(asLamports(overview.creatorClaim.claimableLamports)),paid:formatSol(asLamports(creator.confirmedPaidLamports))});
    }
    if (current()) setCard(card, {
      unclaimed: formatSol(unclaimed), claimed: formatSol(claimed),
      note: `${mine.length} verified ${mine.length === 1 ? 'coin' : 'coins'} · ${formatSol(readyToRequest)} available to request. Unclaimed includes amounts awaiting payout proof.`,
    });
    if(current()) {
      const table=document.createElement('table');table.className='creator-reward-table';
      const caption=table.createCaption();caption.textContent='Verified creator fees by token';
      const heading=table.createTHead().insertRow();
      for(const title of ['Token','Unclaimed','Available to request','Confirmed paid','Action']){const th=document.createElement('th');th.scope='col';th.textContent=title;heading.append(th);}
      const body=table.createTBody();
      for(const row of rows){const tr=body.insertRow();for(const value of [row.name,row.unclaimed,row.available,row.paid])tr.insertCell().textContent=value;const link=document.createElement('a');link.href=`/token/${encodeURIComponent(row.mint)}`;link.textContent='Manage';tr.insertCell().append(link);}
      const wrapper=document.createElement('div');wrapper.className='creator-reward-records';wrapper.tabIndex=0;wrapper.setAttribute('role','region');wrapper.setAttribute('aria-label','Creator fee records');wrapper.append(table);card.append(wrapper);
    }
  } catch {
    if (current()) setCard(card, { note: 'Creator fee records are unavailable. Refresh to try again.' });
  }
}

async function refreshX(card, current) {
  try {
    const data = await getJson('/api/x-fee/claims');
    const summary = summarizeXClaims(data.claims);
    if (!summary) throw new Error('X claims unavailable');
    if (current()) setCard(card, {
      unclaimed: formatXClaimSol(summary.unclaimed), claimed: formatXClaimSol(summary.claimed),
      note: `${summary.unclaimed.count} ready to claim · ${summary.claimed.count} verified paid · ${summary.pending.count} pending verification. Amounts come from the signed-in X account; confirm the destination wallet before claiming.`,
    });
  } catch {
    if (current()) setCard(card, { note: 'X claim records are unavailable. Refresh to try again.' });
  }
}

function refreshPersonalRewards() {
  if (!root) return;
  const id = ++refreshId;
  const walletAddress = document.documentElement.dataset.connectedWallet || '';
  const xConnected = document.querySelector('#x-sign-in')?.dataset.connected === 'true';
  const creator = creatorRewardCard;
  creator.querySelector('.creator-reward-records')?.remove();
  const x = xRewardCard;
  root.hidden = !walletAddress;
  creator.hidden = !walletAddress;
  x.hidden = !walletAddress || !xConnected;
  if (!walletAddress) return;
  const current = () => id === refreshId;
  creator.querySelector('[data-creator-identity]').textContent = `${walletAddress.slice(0, 4)}…${walletAddress.slice(-4)}`;
  setCard(creator, { note: 'Checking verified creator fees…' });
  void refreshCreator(creator, walletAddress, current);
  if (xConnected) {
    x.querySelector('[data-x-identity]').textContent = document.querySelector('#sol-claim-x-account')?.value || 'X connected';
    setCard(x, { note: 'Checking rewards for your X account…' });
    void refreshX(x, current);
  }
}

if (root) {
  window.addEventListener('funded:reward-identity-change', refreshPersonalRewards);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshPersonalRewards(); });
  setInterval(() => { if (!document.hidden) refreshPersonalRewards(); }, 60000);
  refreshPersonalRewards();
}
