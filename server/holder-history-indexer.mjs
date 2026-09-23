import { PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';

const TOKEN_ACCOUNT_MIN_SIZE = 165;
const INDEX_PAGE_SIZE = 1000;
const ACCOUNT_INFO_BATCH_SIZE = 100;
const MAX_INDEX_PAGES = 10_000;

function readU64(buffer, offset) {
  return buffer.readBigUInt64LE(offset);
}

function decodeTokenAccount(address, data) {
  const buffer = Buffer.from(data);
  if (buffer.length < TOKEN_ACCOUNT_MIN_SIZE) throw new Error(`Token account ${address} is shorter than the SPL account layout.`);
  if (buffer[108] === 0) throw new Error(`Token account ${address} is uninitialized.`);
  return {
    account: address,
    mint: new PublicKey(buffer.subarray(0, 32)).toBase58(),
    wallet: new PublicKey(buffer.subarray(32, 64)).toBase58(),
    balance: String(readU64(buffer, 64)),
  };
}

function mintSupply(data) {
  const buffer = Buffer.from(data || []);
  if (buffer.length < 45) throw new Error('Reward mint is shorter than the SPL mint layout.');
  return readU64(buffer, 36);
}

function assertCompleteCoverage(decoded, mintAccount, label) {
  const covered = decoded.reduce((sum, row) => sum + BigInt(row.balance), 0n);
  const supply = mintSupply(mintAccount.data);
  if (covered !== supply) throw new Error(`${label} coverage is ${covered} of ${supply} token units.`);
}

async function completeLargestAccountsFallback(connection, mint, mintAccount) {
  const largest = await connection.getTokenLargestAccounts(mint, 'finalized');
  const rows = largest?.value || [];
  if (!rows.length) throw new Error('Full holder indexing is unavailable and the mint has no indexed token accounts.');
  const addresses = rows.map(row => row.address);
  const infos = await connection.getMultipleAccountsInfo(addresses, 'finalized');
  const decoded = infos.map((account, index) => {
    if (!account) throw new Error(`Largest token account ${addresses[index].toBase58()} is unavailable.`);
    return decodeTokenAccount(addresses[index].toBase58(), account.data);
  }).filter(row => row.mint === mint.toBase58() && BigInt(row.balance) > 0n);
  assertCompleteCoverage(decoded, mintAccount, 'Full holder indexing is unavailable: largest-account');
  return { decoded, source:'largest-accounts-complete' };
}

async function completeIndexedAccountsFallback(connection, mint, mintAccount, rpcUrl, fetchImpl) {
  if (!rpcUrl || typeof fetchImpl !== 'function') throw new Error('An indexed token-account endpoint is not configured.');
  const addresses = new Map();
  for (let page = 1; page <= MAX_INDEX_PAGES; page += 1) {
    const response = await fetchImpl(rpcUrl, {
      method:'POST',
      headers:{ 'content-type':'application/json' },
      body:JSON.stringify({ jsonrpc:'2.0', id:`funded-holder-index-${page}`, method:'getTokenAccounts', params:{ mint:mint.toBase58(), page, limit:INDEX_PAGE_SIZE, displayOptions:{} } }),
    });
    if (!response.ok) throw new Error(`Indexed token-account request failed with HTTP ${response.status}.`);
    const payload = await response.json();
    if (payload.error) throw new Error(`Indexed token-account request failed: ${payload.error.message || payload.error.code || 'unknown error'}.`);
    const rows = payload.result?.token_accounts;
    if (!Array.isArray(rows)) throw new Error('Indexed token-account response is missing token_accounts.');
    for (const row of rows) {
      const address = new PublicKey(row.address);
      addresses.set(address.toBase58(), address);
    }
    if (rows.length < INDEX_PAGE_SIZE) break;
    if (page === MAX_INDEX_PAGES) throw new Error('Indexed token-account pagination exceeded the safety limit.');
  }
  const decoded = [];
  const indexed = [...addresses.values()];
  for (let offset = 0; offset < indexed.length; offset += ACCOUNT_INFO_BATCH_SIZE) {
    const batch = indexed.slice(offset, offset + ACCOUNT_INFO_BATCH_SIZE);
    const infos = await connection.getMultipleAccountsInfo(batch, 'finalized');
    for (let index = 0; index < batch.length; index += 1) {
      const account = infos[index];
      if (!account) continue;
      if (!account.owner?.equals?.(mintAccount.owner)) throw new Error(`Indexed account ${batch[index].toBase58()} is not owned by the reward mint token program.`);
      const row = decodeTokenAccount(batch[index].toBase58(), account.data);
      if (row.mint === mint.toBase58() && BigInt(row.balance) > 0n) decoded.push(row);
    }
  }
  assertCompleteCoverage(decoded, mintAccount, 'Indexed token-account');
  return { decoded, source:'indexed-token-accounts-complete' };
}

export function snapshotsForPeriod(snapshots, start, end, maxGapSeconds) {
  const ordered = [...(snapshots || [])].filter(row => row.finalized && row.at <= end).sort((a, b) => a.at - b.at);
  const opening = ordered.filter(row => row.at <= start).at(-1);
  const interior = ordered.filter(row => row.at > start && row.at < end);
  const closingSource = ordered.filter(row => row.at < end).at(-1);
  if (!opening || !closingSource) throw new Error('Finalized holder snapshots do not cover this reward period.');
  const selected = [{ ...opening, at: start }, ...interior, { ...closingSource, at: end }];
  for (let index = 1; index < selected.length; index += 1) {
    if (selected[index].at - selected[index - 1].at > maxGapSeconds) throw new Error('Holder snapshot gap exceeds the configured sampling interval.');
  }
  return selected;
}

export function createHolderHistoryIndexer({ connection, store, rpcUrl = connection?.rpcEndpoint, fetchImpl = globalThis.fetch, maxSnapshotsPerMint = 600 }) {
  async function capture(mintValue, observedAt = Date.now()) {
    const mint = new PublicKey(mintValue);
    const mintAccount = await connection.getAccountInfo(mint, 'finalized');
    if (!mintAccount) throw new Error('Reward mint does not exist at finalized commitment.');
    const tokenProgram = mintAccount.owner;
    if (!tokenProgram.equals(TOKEN_PROGRAM_ID) && !tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) throw new Error('Reward mint is not owned by a supported SPL token program.');
    const slot = await connection.getSlot('finalized');
    const blockTime = await connection.getBlockTime(slot);
    let decoded, source = 'program-accounts';
    try {
      const tokenAccounts = await connection.getProgramAccounts(tokenProgram, { commitment: 'finalized', filters: [{ memcmp: { offset: 0, bytes: mint.toBase58() } }] });
      decoded = tokenAccounts.map(row => decodeTokenAccount(row.pubkey.toBase58(), row.account.data)).filter(row => row.mint === mint.toBase58() && BigInt(row.balance) > 0n);
      assertCompleteCoverage(decoded, mintAccount, 'Program-account');
    } catch (error) {
      if (!/excluded from account secondary indexes|method unavailable|unavailable for key/i.test(String(error?.message || error))) throw error;
      try { ({ decoded, source } = await completeIndexedAccountsFallback(connection, mint, mintAccount, rpcUrl, fetchImpl)); }
      catch (indexedError) {
        try { ({ decoded, source } = await completeLargestAccountsFallback(connection, mint, mintAccount)); }
        catch (largestError) { throw new Error(`${indexedError.message} ${largestError.message}`); }
      }
    }
    const balances = new Map();
    for (const row of decoded) balances.set(row.wallet, (balances.get(row.wallet) || 0n) + BigInt(row.balance));
    const accounts = [...balances].sort(([a], [b]) => a.localeCompare(b)).map(([wallet, balance]) => ({ account:`owner:${wallet}`, wallet, balance:String(balance) }));
    const snapshot = { mint: mint.toBase58(), slot, blockTime, at: Math.floor(observedAt / 1000), finalized: true, coverage: 'finalized-sampled-v1', source, tokenProgram: tokenProgram.toBase58(), tokenAccountCount:decoded.length, holderCount:accounts.length, accounts };
    await store.transaction(state => {
      state.holderSnapshots ||= {};
      const history = state.holderSnapshots[snapshot.mint] ||= [];
      const prior = history.at(-1);
      if (prior && (snapshot.slot < prior.slot || snapshot.at < prior.at)) throw new Error('Holder snapshot order regressed.');
      if (!prior || prior.slot !== snapshot.slot) history.push(snapshot);
      if (history.length > maxSnapshotsPerMint) history.splice(0, history.length - maxSnapshotsPerMint);
    });
    return snapshot;
  }
  return { capture };
}
