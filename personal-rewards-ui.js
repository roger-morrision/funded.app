import { creatorRewardRow } from './creator-reward-model.js';
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
      if (current()) setCard(card, { unclaimed: '0 SOL', claimed: '0 SOL', note: 'No creator rewards yet. Launch a token to get started.' });
      return;
    }
    const activities = await Promise.all(mine.map(launch => getJson(`/api/tokens/${encodeURIComponent(launch.mint)}/fee-activity`)));
    const rows = mine.map((launch, index) => creatorRewardRow(launch, activities[index], walletAddress, EXPLORE_CLUSTER));
    if (!current()) return;
    const sum = key => rows.reduce((total, row) => total + row[key], 0n);
    setCard(card, { unclaimed:formatSol(rows.filter(row => row.ready).reduce((total,row)=>total+row.available,0n)), claimed:formatSol(sum('paid')),
      note:`${rows.length} ${rows.length === 1 ? 'token' : 'tokens'}` });
    renderCreatorRows(card, rows);

  } catch {
    if (current()) setCard(card, { note: 'Creator fee records are unavailable. Refresh to try again.' });
  }
}

const pendingClaims = new Set();
const expandedMints = new Set();
function renderCreatorRows(card, rows) {
  const list = document.createElement('div'); list.className = 'creator-reward-records creator-claim-list';
  for (const row of rows) {
    const article = document.createElement('article'); article.className = 'creator-claim-card';
    const heading = document.createElement('div'); heading.className = 'creator-claim-heading';
    const name = document.createElement('a'); name.href = `/token/${encodeURIComponent(row.mint)}`; name.textContent = row.name;
    const state = document.createElement('span'); state.className = 'creator-claim-state'; state.textContent = row.status;
    heading.append(name,state);
    const amount = document.createElement('strong'); amount.className = 'creator-claim-amount'; amount.textContent = formatSol(row.available);
    const label = document.createElement('small'); label.textContent = row.ready ? 'Available to claim' : 'Reward balance';
    const button = document.createElement('button'); button.type = 'button'; button.className = 'primary-button';
    const signing = document.documentElement.dataset.creatorClaimSigning === 'true';
    button.textContent = pendingClaims.has(row.mint) ? 'Requesting payout…' : 'Claim SOL';
    button.disabled = !row.ready || !signing || pendingClaims.has(row.mint);
    button.setAttribute('aria-label',`Claim SOL from ${row.name}`);
    const note = document.createElement('p'); note.className = 'field-help';
    note.textContent = !signing ? 'Open this app in your wallet to sign a claim.' : row.ready ? 'Approve a wallet message to request payment.'
      : row.status === 'Payment processing' ? 'Waiting for payment confirmation.' : `Claim minimum: ${formatSol(row.minimum)}.`;
    button.addEventListener('click', () => {
      if (pendingClaims.has(row.mint)) return;
      pendingClaims.add(row.mint); button.disabled = true;
      window.dispatchEvent(new CustomEvent('funded:creator-claim', { detail:{ button, mint:row.mint, overview:row.overview,
        complete:() => { pendingClaims.delete(row.mint); refreshPersonalRewards(); } } }));
    });
    const details = document.createElement('details'); details.className = 'advanced-details'; details.open = expandedMints.has(row.mint);
    const summary = document.createElement('summary'); summary.textContent = 'Advanced details · verification';
    const values = document.createElement('dl');
    for (const [title,value] of [['Unpaid total',formatSol(row.unclaimed)],['Confirmed paid',formatSol(row.paid)],['Claim minimum',formatSol(row.minimum)],['Token address',row.mint]]) {
      const dt=document.createElement('dt');dt.textContent=title;const dd=document.createElement('dd');dd.textContent=value;values.append(dt,dd);
    }
    const explanation = document.createElement('p'); explanation.textContent = 'Unpaid includes rewards awaiting payment confirmation. Only confirmed payments count as paid.';
    details.append(summary,values,explanation);
    details.addEventListener('toggle',()=>{if(details.open)expandedMints.add(row.mint);else expandedMints.delete(row.mint);});
    article.append(heading,label,amount,button,note,details); list.append(article);
  }
  card.append(list);
}

async function refreshX(card, current) {
  try {
    const data = await getJson('/api/x-fee/claims');
    const summary = summarizeXClaims(data.claims);
    if (!summary) throw new Error('X claims unavailable');
    if (current()) setCard(card, {
      unclaimed: formatXClaimSol(summary.unclaimed), claimed: formatXClaimSol(summary.claimed),
      note: `${summary.unclaimed.count} ready · ${summary.claimed.count} paid · ${summary.pending.count} processing`,
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
  creatorRewardCard.querySelector('[data-creator-unclaimed]').previousElementSibling.textContent = 'Ready to claim';
  creatorRewardCard.querySelector('[data-creator-claimed]').previousElementSibling.textContent = 'Paid';
  const refreshButton = document.createElement('button'); refreshButton.type='button'; refreshButton.className='text-button'; refreshButton.textContent='Refresh rewards';
  refreshButton.addEventListener('click',refreshPersonalRewards); creatorRewardCard.append(refreshButton);
  window.addEventListener('funded:reward-identity-change', () => { expandedMints.clear(); refreshPersonalRewards(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshPersonalRewards(); });
  setInterval(() => { if (!document.hidden && !pendingClaims.size && !creatorRewardCard.contains(document.activeElement)) refreshPersonalRewards(); }, 60000);
  refreshPersonalRewards();
}
