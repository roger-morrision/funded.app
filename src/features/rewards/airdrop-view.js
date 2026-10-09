import { escapeHtml } from '../shared/display.js';
import { canSignTransactions } from '../../../wallet-core.js';
import { sortClaimers, claimantWalletLabel, claimerRate } from '../../../airdrop-claimers-model.js';

// Receive current state on every render; the application owns data and wallet lifecycles.
export function renderAirdropProgramDetail(
  program,
  {
    connectedWalletAddress,
    communityClaimPolicy,
    wallet,
    APP_EXPLORER_QUERY,
  },
  {
    formatTokenAmount,
    formatVerifiedAirdropAmount,
    document = globalThis.document,
  } = {}
) {
  const panel = document.querySelector('#airdrop-selected-program');
  if (!panel) return;
  panel.dataset.mint = program.id;
  const unavailableButton = document.querySelector('#airdrop-claim-unavailable');
  if (unavailableButton) unavailableButton.hidden = program.claimActive;
  const eyebrow = document.querySelector('#airdrop-selected-eyebrow');
  if (eyebrow) eyebrow.textContent = program.vaultVerified ? 'Airdrop funding confirmed' : 'Airdrop funding pending';
  document.querySelector('#airdrop-selected-title').textContent = `${program.name} (${program.symbol})`;
  document.querySelector('#airdrop-selected-stats').innerHTML = `<span><small>Airdrop allocation</small><strong>${formatTokenAmount(program.reservedTokens)} tokens · ${program.allocationPercent}% of supply</strong></span><span><small>Claimed</small><strong>${formatVerifiedAirdropAmount(program.claimedTokens)}</strong></span><span><small>Eligible wallets</small><strong>${formatVerifiedAirdropAmount(program.eligibleWallets)}</strong></span><span><small>Claim window</small><strong>${program.claimPublished ? 'Claim your full allocation once within 90 days' : 'Not open yet'}</strong></span><details class="airdrop-verification-details advanced-details"><summary>Advanced details · verification</summary><div class="airdrop-program-detail-stats"><span><small>Snapshot</small><strong>${escapeHtml(program.snapshot)}</strong></span><span><small>Snapshot hash</small><strong class="airdrop-proof-value">${escapeHtml(program.snapshotHash || 'Pending verified snapshot')}</strong></span><span><small>Proof root</small><strong class="airdrop-proof-value">${escapeHtml(program.merkleRoot || 'Pending published proof')}</strong></span></div></details>`;
  const status = document.querySelector('#airdrop-selected-status');
  status.textContent = program.claimActive
    ? `$FUNDED holders recorded when this token moved to its trading pool can check their allocation and claim by ${program.deadline}.`
    : program.status === 'closed'
    ? `The claim window ended ${program.deadline}. You can still review past claims and verification details.`
    : program.vaultVerified
    ? `${formatTokenAmount(program.reservedTokens)} tokens are set aside. Claims will open after the token moves to its trading pool and the eligible wallet list is confirmed.`
    : 'This airdrop is planned. Funding and wallet eligibility must be confirmed before claims can open.';
  if (program.claimActive) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'secondary-button'; button.dataset.checkCommunityMint = program.id;
    button.textContent = connectedWalletAddress ? 'Check my allocation' : 'Connect wallet to check allocation';
    status.append(document.createElement('br'), button);
  }
  if (communityClaimPolicy?.windowDays === 90 && communityClaimPolicy.unclaimedRecipient && communityClaimPolicy.status === 'not-activated') {
    status.append(document.createTextNode(` Planned policy: unclaimed tokens go to app owner ${communityClaimPolicy.unclaimedRecipient} after 90 days. Claim program not activated.`));
  }
  if (program.vaultVerified && /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(program.fundingSignature || '')) {
    const receipt = document.createElement('a');
    receipt.href = `https://explorer.solana.com/tx/${program.fundingSignature}${APP_EXPLORER_QUERY}`;
    receipt.target = '_blank'; receipt.rel = 'noopener noreferrer';
    receipt.textContent = ' Verify funding transaction ↗';
    status.append(receipt);
  }
  if (!program.claimActive && !program.vaultVerified && program.vaultInitialized && program.creatorWallet === connectedWalletAddress && canSignTransactions(wallet)) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'secondary-button'; button.dataset.fundCommunityMint = program.id;
    button.textContent = `Review funding ${formatTokenAmount(program.reservedTokens)} ${program.symbol}`;
    status.append(document.createElement('br'), button);
  } else if (!program.vaultVerified && program.creatorWallet === connectedWalletAddress && !program.vaultInitialized) {
    status.append(document.createTextNode(' The reward vault must be initialized before your wallet can fund it.'));
  }
  panel.hidden = false;
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

export function renderAirdropAnalytics(
  {
    indexedClaimers,
    demoAirdropNotifications,
    demoAirdropHistory,
  },
  {
    formatTokenAmount,
    getAirdropPrograms,
    airdropClaimRate,
    loadVerifiedTokenLogos,
    getVerifiedUnclaimedWallets,
    document = globalThis.document,
  } = {}
) {
  const claimers = document.querySelector('#airdrop-top-claimers');
  const programs = document.querySelector('#airdrop-top-programs');
  const wallets = document.querySelector('#unclaimed-wallets');
  const leaderboardSort = document.querySelector('#leaderboard-sort')?.value || 'amount';
  const privateMode = document.querySelector('#leaderboard-private')?.checked ?? true;
  const sortControl = document.querySelector('#leaderboard-sort');
  const privacyControl = document.querySelector('#leaderboard-private');
  if (sortControl) sortControl.disabled = indexedClaimers.length === 0;
  if (privacyControl) privacyControl.disabled = indexedClaimers.length === 0;
  const sortedClaimers = sortClaimers(indexedClaimers, leaderboardSort);
  if (claimers) claimers.innerHTML = sortedClaimers.map((item, index) => `<div class="leader-row"><b>${index + 1}</b><span><strong>${escapeHtml(claimantWalletLabel(item.wallet, privateMode))}</strong><small>${escapeHtml(item.symbol)} claimed${claimerRate(item) == null ? '' : ` · ${(claimerRate(item) * 100).toFixed(1)}% of allocation`}</small></span><em>${formatTokenAmount(item.amount)}</em></div>`).join('') || '<div class="empty-state">Verified claimant receipts are not indexed yet. Ranking and privacy controls will appear when verified rows are available.</div>';
  if (programs) programs.innerHTML = getAirdropPrograms().sort((a, b) => b.reservedTokens - a.reservedTokens).slice(0, 5).map((item, index) => {
    const rate = airdropClaimRate(item);
    const claimLabel = rate == null ? 'Snapshot pending' : rate > 0 && rate * 100 < 0.05 ? '<0.1% claimed' : `${(rate * 100).toFixed(1)}% claimed`;
    return `<div class="leader-row" data-logo-mint="${escapeHtml(item.id)}"><b>${index + 1}</b><i class="leader-token-logo" aria-hidden="true">${escapeHtml(String(item.symbol || "T").slice(0, 1))}</i><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.symbol)} · ${escapeHtml(claimLabel)}</small></span><em>${formatTokenAmount(item.reservedTokens)}</em></div>`;
  }).join('');
  loadVerifiedTokenLogos(programs);
  const verifiedWallets = getVerifiedUnclaimedWallets();
  if (wallets) wallets.innerHTML = verifiedWallets.map(item => `<tr><td><strong>${item.wallet}</strong></td><td>${item.program}</td><td>${formatTokenAmount(item.eligible)}</td><td>${formatTokenAmount(item.claimed)}</td><td>${formatTokenAmount(item.eligible - item.claimed)}</td><td><span class="wallet-claim-status">${item.status}</span></td></tr>`).join('');
  const count = document.querySelector('#unclaimed-wallet-count');
  if (count) count.textContent = verifiedWallets.length ? `${verifiedWallets.length} verified wallets`
    : getAirdropPrograms().some(item => item.claimActive) ? 'Unclaimed wallet list unavailable' : 'Eligibility snapshot pending';
  const exportButton = document.querySelector('#airdrop-export-csv');
  if (exportButton) exportButton.disabled = verifiedWallets.length === 0;
  const notificationNode = document.querySelector('#airdrop-notifications');
  if (notificationNode) notificationNode.innerHTML = demoAirdropNotifications.map(item => `<div class="notification-row ${item.tone}"><b>${item.icon}</b><span><strong>${item.title}</strong><small>${item.detail}</small></span></div>`).join('');
  const historyNode = document.querySelector('#airdrop-history');
  if (historyNode) historyNode.innerHTML = `<p class="history-label">Recent activity</p>${demoAirdropHistory.map(item => `<div class="history-row"><span><strong>${item.token} · ${item.event}</strong><small>${item.date} · ${item.status}</small></span><em>${item.amount}</em></div>`).join('')}`;
}
