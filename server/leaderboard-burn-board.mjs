const verifiedAmount = value => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
};

const timestamp = value => {
  const parsed = typeof value === 'number' ? value * 1000 : Date.parse(String(value || ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

// Public project totals include only receipts already verified by the app's
// launch or BurnChecked verifier. Unattributed burns remain out of this board.
export function projectBurnBoard(state, cluster) {
  const projects = new Map();
  for (const launch of Object.values(state?.launches || {})) {
    if (!launch?.onchainVerified || launch.cluster !== cluster || !launch.mint) continue;
    projects.set(launch.mint, {
      mint: launch.mint,
      name: String(launch.name || 'Verified launch'),
      symbol: String(launch.symbol || 'TOKEN'),
      burnedTokens: 0,
      receiptCount: 0,
      lastBurnAt: 0,
      latestSignature: null,
      wallets: new Set(),
    });
  }

  const seen = new Set();
  const include = (project, { signature, amountTokens, wallet, at }) => {
    if (!project || !signature || seen.has(signature)) return;
    const amount = verifiedAmount(amountTokens);
    if (amount == null) return;
    seen.add(signature);
    project.burnedTokens += amount;
    project.receiptCount += 1;
    if (wallet) project.wallets.add(wallet);
    const when = timestamp(at);
    if (!project.latestSignature || when >= project.lastBurnAt) {
      project.lastBurnAt = when;
      project.latestSignature = signature;
    }
  };

  for (const launch of Object.values(state?.launches || {})) {
    const burn = launch?.creatorLaunchBurn;
    const receipt = burn?.receipt;
    if (burn?.status !== 'verified' || receipt?.verified !== true
      || receipt.instruction !== 'BurnChecked' || receipt.atomicWithPumpLaunch !== true) continue;
    include(projects.get(launch.mint), {
      signature: receipt.signature,
      amountTokens: receipt.amountTokens ?? burn.amountTokens,
      wallet: launch.creatorWallet || launch.feePayer,
      at: launch.onchainVerifiedAt || launch.createdTimestamp,
    });
  }

  for (const receipt of Object.values(state?.burnReceipts || {})) {
    if (receipt?.cluster !== cluster || receipt.status !== 'verified'
      || receipt.onchainVerified !== true || receipt.instruction !== 'BurnChecked') continue;
    include(projects.get(receipt.projectMint), {
      signature: receipt.signature,
      amountTokens: receipt.amountTokens,
      wallet: receipt.wallet,
      at: receipt.verifiedAt || receipt.blockTime,
    });
  }

  return [...projects.values()]
    .filter(project => project.receiptCount > 0)
    .map(({ wallets, ...project }) => ({ ...project, burnerCount: wallets.size,
      lastBurnAt: project.lastBurnAt ? new Date(project.lastBurnAt).toISOString() : null }))
    .sort((a, b) => b.burnedTokens - a.burnedTokens || a.mint.localeCompare(b.mint));
}

// Wallet ranking includes only confirmed BurnChecked receipts on the selected network.
// A launch burn can also appear in burnReceipts, so signatures are counted once.
export function walletBurnBoard(state, cluster) {
  const wallets = new Map();
  const seen = new Set();
  const include = ({ signature, amountTokens, wallet, at }) => {
    if (!signature || seen.has(signature) || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(wallet || ''))) return;
    const amount = verifiedAmount(amountTokens);
    if (amount == null) return;
    seen.add(signature);
    const when = timestamp(at);
    const row = wallets.get(wallet) || { wallet, burnedTokens: 0, receiptCount: 0, firstBurnAt: 0, latestBurnAt: 0, latestSignature: null };
    row.burnedTokens += amount;
    row.receiptCount += 1;
    if (when && (!row.firstBurnAt || when < row.firstBurnAt)) row.firstBurnAt = when;
    if (!row.latestSignature || when >= row.latestBurnAt) { row.latestBurnAt = when; row.latestSignature = signature; }
    wallets.set(wallet, row);
  };

  for (const launch of Object.values(state?.launches || {})) {
    const burn = launch?.creatorLaunchBurn;
    const receipt = burn?.receipt;
    if (!launch?.onchainVerified || launch.cluster !== cluster || burn?.status !== 'verified'
      || receipt?.verified !== true || receipt.instruction !== 'BurnChecked'
      || receipt.atomicWithPumpLaunch !== true) continue;
    include({ signature: receipt.signature, amountTokens: receipt.amountTokens ?? burn.amountTokens,
      wallet: launch.creatorWallet || launch.feePayer, at: launch.onchainVerifiedAt || launch.createdTimestamp });
  }
  for (const receipt of Object.values(state?.burnReceipts || {})) {
    if (receipt?.cluster !== cluster || receipt.status !== 'verified'
      || receipt.onchainVerified !== true || receipt.instruction !== 'BurnChecked') continue;
    include({ signature: receipt.signature, amountTokens: receipt.amountTokens,
      wallet: receipt.wallet, at: receipt.verifiedAt || receipt.blockTime });
  }
  return [...wallets.values()].map(row => ({ ...row,
    firstBurnAt: row.firstBurnAt ? new Date(row.firstBurnAt).toISOString() : null,
    latestBurnAt: row.latestBurnAt ? new Date(row.latestBurnAt).toISOString() : null,
  })).sort((a, b) => b.burnedTokens - a.burnedTokens || a.wallet.localeCompare(b.wallet));
}
