import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PUMP_PROGRAM_ID } from '@pump-fun/pump-sdk';
import { PUMP_AMM_PROGRAM_ID, canonicalPumpPoolPda } from '@pump-fun/pump-swap-sdk';

const TOKEN_ACCOUNT_MIN_SIZE = 165;
const MAX_REPLAY_SLOTS = 256;
const MIGRATE_V2_DISCRIMINATOR = createHash('sha256').update('global:migrate_v2').digest().subarray(0, 8);

function amount(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error('A token balance is missing its exact base-unit amount.');
  return BigInt(value);
}

function tokenAccount(pubkey, data, mint) {
  const bytes = Buffer.from(data || []);
  if (bytes.length < TOKEN_ACCOUNT_MIN_SIZE || bytes[108] === 0 || !new PublicKey(bytes.subarray(0, 32)).equals(mint)) {
    throw new Error('A holder token account has an invalid SPL layout or mint.');
  }
  return { account:new PublicKey(pubkey).toBase58(), wallet:new PublicKey(bytes.subarray(32, 64)).toBase58(), balance:bytes.readBigUInt64LE(64) };
}

function transactionKeys(transaction) {
  const message = transaction.transaction?.message;
  const raw = message?.accountKeys || message?.staticAccountKeys;
  if (!Array.isArray(raw)) throw new Error('Finalized transaction lacks account keys.');
  const keys = raw.map(value => new PublicKey(value.pubkey || value));
  const loaded = transaction.meta?.loadedAddresses;
  // Raw v0 messages have only static keys. Parsed messages already include
  // loaded addresses in accountKeys. Never guess an accountIndex target.
  if (!message.accountKeys && loaded) {
    keys.push(...(loaded.writable || []).map(value => new PublicKey(value)));
    keys.push(...(loaded.readonly || []).map(value => new PublicKey(value)));
  }
  return keys;
}

export function verifyPumpMigrationTransaction({ transaction, launchMint }) {
  if (!transaction?.meta || transaction.meta.err || !Number.isSafeInteger(transaction.slot)
    || !Number.isSafeInteger(transaction.blockTime)) throw new Error('Finalized, successful migration receipt is required.');
  const launch = new PublicKey(launchMint), pool = canonicalPumpPoolPda(launch, NATIVE_MINT);
  const keys = transactionKeys(transaction);
  const instructions = transaction.transaction.message.instructions || transaction.transaction.message.compiledInstructions || [];
  const migration = instructions.find(instruction => {
    const program = keys[instruction.programIdIndex];
    if (!program?.equals(PUMP_PROGRAM_ID)) return false;
    try { return Buffer.from(bs58.decode(instruction.data)).subarray(0, 8).equals(MIGRATE_V2_DISCRIMINATOR); }
    catch { return false; }
  });
  if (!migration || !Array.isArray(migration.accounts)
    || !migration.accounts.some(index => keys[index]?.equals(launch))
    || !migration.accounts.some(index => keys[index]?.equals(pool))) {
    throw new Error('Receipt does not contain Pump migrate_v2 for this launch mint and canonical pool.');
  }
  return { pool, slot:transaction.slot, blockTime:transaction.blockTime };
}

function rowsFromTransaction(transaction, mint, side) {
  const balances = transaction.meta?.[side];
  if (!Array.isArray(balances)) throw new Error('Finalized block lacks complete token-balance metadata.');
  const keys = transactionKeys(transaction);
  const rows = new Map();
  for (const row of balances) {
    if (row.mint !== mint) continue;
    const rawKey = keys[row.accountIndex];
    if (!rawKey) throw new Error('Token balance refers to an unavailable or unresolved transaction account.');
    const account = rawKey.toBase58();
    const balance = amount(row.uiTokenAmount?.amount);
    if (!row.owner && balance > 0n) throw new Error('Positive historical token balance has no owner.');
    if (rows.has(account)) throw new Error('Duplicate token-balance entry in finalized transaction.');
    rows.set(account, { account, wallet:row.owner ? new PublicKey(row.owner).toBase58() : null, balance });
  }
  return rows;
}

function positive(rows) {
  return [...rows.values()].filter(row => row.balance > 0n);
}

function sum(rows) {
  return positive(rows).reduce((total, row) => total + row.balance, 0n);
}

async function completeFinalizedBase(connection, mintKey) {
  const mintAddress = mintKey.toBase58();
  // For a small holder set, one atomic account read is enough. Completeness
  // follows from the fixed mint supply, not from a top-20 assumption.
  try {
    const largest = await connection.getTokenLargestAccounts(mintKey, 'finalized');
    const addresses = [...new Map((largest.value || []).map(row => [row.address.toBase58(), row.address])).values()];
    if (addresses.length && addresses.length <= 20) {
      const batch = await connection.getMultipleAccountsInfoAndContext([mintKey, ...addresses], { commitment:'finalized', minContextSlot:largest.context.slot });
      const mintInfo = batch.value[0];
      if (!mintInfo || (!mintInfo.owner.equals(TOKEN_PROGRAM_ID) && !mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID))
        || mintInfo.data.length < 82 || mintInfo.data.readUInt32LE(0) !== 0) throw new Error('Eligibility mint must have disabled mint authority.');
      const supply = mintInfo.data.readBigUInt64LE(36);
      const accounts = batch.value.slice(1).map((row, index) => {
        if (!row?.owner.equals(mintInfo.owner)) throw new Error('Largest token account is missing or has the wrong owner program.');
        return tokenAccount(addresses[index], row.data, mintKey);
      });
      if (accounts.reduce((total, row) => total + row.balance, 0n) === supply) {
        return { slot:batch.context.slot, accounts, supply };
      }
    }
  } catch (error) {
    // A failed bounded read may still be served by the complete program index.
    if (/mint authority/.test(String(error?.message || error))) throw error;
  }
  const mintInfo = await connection.getAccountInfo(mintKey, 'finalized');
  if (!mintInfo || (!mintInfo.owner.equals(TOKEN_PROGRAM_ID) && !mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID))
    || mintInfo.data.length < 82 || mintInfo.data.readUInt32LE(0) !== 0) {
    throw new Error('Eligibility mint must be a supported fixed-supply SPL mint with disabled mint authority.');
  }
  const supply = mintInfo.data.readBigUInt64LE(36);
  const listed = await connection.getProgramAccounts(mintInfo.owner, { commitment:'finalized', withContext:true,
    filters:[{ memcmp:{ offset:0, bytes:mintAddress } }] });
  if (!Number.isSafeInteger(listed?.context?.slot) || !Array.isArray(listed.value)) throw new Error('RPC did not return an atomic finalized token-account context.');
  const accounts = listed.value.map(row => tokenAccount(row.pubkey, row.account.data, mintKey));
  if (accounts.reduce((total, row) => total + row.balance, 0n) !== supply) {
    throw new Error('Atomic token-account base does not cover the full fixed supply.');
  }
  return { slot:listed.context.slot, accounts, supply };
}

// A current RPC account read is never presented as a historical snapshot. Every
// produced block after the migration must be available so its token changes can
// be undone in reverse transaction order.
export function reverseReplayCommunitySnapshot({ mint, migrationSlot, migrationBlockTime, baseSlot, baseAccounts, supplyBaseUnits, blockSlots, blocks }) {
  const mintKey = new PublicKey(mint).toBase58();
  if (!Number.isSafeInteger(migrationSlot) || migrationSlot <= 0 || !Number.isSafeInteger(migrationBlockTime) || migrationBlockTime <= 0
    || !Number.isSafeInteger(baseSlot) || baseSlot < migrationSlot || baseSlot - migrationSlot > MAX_REPLAY_SLOTS) {
    throw new Error('Migration-to-base replay exceeds the verified bounded slot range.');
  }
  const supply = amount(String(supplyBaseUnits));
  if (supply <= 0n) throw new Error('Eligibility mint has no positive supply.');
  const ledger = new Map();
  for (const row of baseAccounts || []) {
    const account = new PublicKey(row.account).toBase58();
    if (ledger.has(account)) throw new Error('Duplicate base token account.');
    ledger.set(account, { account, wallet:new PublicKey(row.wallet).toBase58(), balance:amount(String(row.balance)) });
  }
  if (sum(ledger) !== supply) throw new Error('Base token accounts do not cover the full eligibility supply.');
  const orderedSlots = [...(blockSlots || [])];
  if (orderedSlots.some((slot, index) => !Number.isSafeInteger(slot) || slot <= migrationSlot || slot > baseSlot
    || (index && slot <= orderedSlots[index - 1]))) throw new Error('Finalized block slot list is invalid.');
  if (!blocks || orderedSlots.some(slot => !blocks.has(slot))) throw new Error('At least one finalized replay block is missing.');
  for (let blockIndex = orderedSlots.length - 1; blockIndex >= 0; blockIndex -= 1) {
    const slot = orderedSlots[blockIndex], block = blocks.get(slot);
    if (!Array.isArray(block?.transactions)) throw new Error(`Finalized block ${slot} lacks complete transactions.`);
    for (let txIndex = block.transactions.length - 1; txIndex >= 0; txIndex -= 1) {
      const tx = block.transactions[txIndex];
      const post = rowsFromTransaction(tx, mintKey, 'postTokenBalances');
      const pre = rowsFromTransaction(tx, mintKey, 'preTokenBalances');
      for (const account of new Set([...post.keys(), ...pre.keys()])) {
        const expectedPost = post.get(account), observed = ledger.get(account);
        if ((expectedPost?.balance || 0n) !== (observed?.balance || 0n)
          || (expectedPost?.balance > 0n && expectedPost.wallet !== observed?.wallet)) {
          throw new Error(`Token replay diverged at slot ${slot}, transaction ${txIndex}, account ${account}.`);
        }
        const before = pre.get(account);
        if (before?.balance > 0n) ledger.set(account, before);
        else ledger.delete(account);
      }
    }
  }
  if (sum(ledger) !== supply) throw new Error('Historical token balances do not cover the fixed eligibility supply.');
  const byWallet = new Map();
  for (const row of positive(ledger)) byWallet.set(row.wallet, (byWallet.get(row.wallet) || 0n) + row.balance);
  const accounts = [...byWallet].sort(([a], [b]) => a.localeCompare(b)).map(([wallet, balance]) => ({ wallet, balance:String(balance) }));
  return { mint:mintKey, slot:migrationSlot, blockTime:migrationBlockTime, finalized:true,
    coverage:'finalized-exact-slot-v1', source:'complete-finalized-base-plus-reverse-block-replay-v1',
    baseSlot, replayedBlocks:orderedSlots.length, supplyBaseUnits:String(supply), accounts };
}

export async function captureExactCommunitySnapshot({ connection, mint, launchMint, migrationSignature, maxReplaySlots = MAX_REPLAY_SLOTS }) {
  const mintKey = new PublicKey(mint), mintAddress = mintKey.toBase58(), launchKey = new PublicKey(launchMint);
  const transaction = await connection.getTransaction(migrationSignature, { commitment:'finalized', maxSupportedTransactionVersion:0 });
  const { pool } = verifyPumpMigrationTransaction({ transaction, launchMint:launchKey });
  const poolInfo = await connection.getAccountInfo(pool, 'finalized');
  if (!poolInfo?.owner.equals(PUMP_AMM_PROGRAM_ID)) throw new Error('Canonical migrated pool is unavailable or has the wrong owner.');
  const migrationSlot = transaction.slot;
  const finalizedTip = await connection.getSlot('finalized');
  if (finalizedTip < migrationSlot || finalizedTip - migrationSlot > Math.min(maxReplaySlots, MAX_REPLAY_SLOTS)) {
    throw new Error('Migration is outside the bounded historical replay window; an archival exact-slot snapshot is required.');
  }
  const base = await completeFinalizedBase(connection, mintKey);
  const baseSlot = base.slot;
  if (baseSlot < migrationSlot || baseSlot - migrationSlot > Math.min(maxReplaySlots, MAX_REPLAY_SLOTS)) {
    throw new Error('Migration is outside the bounded historical replay window; an archival exact-slot snapshot is required.');
  }
  const slots = baseSlot === migrationSlot ? [] : await connection.getBlocks(migrationSlot + 1, baseSlot, 'finalized');
  if (!Array.isArray(slots)) throw new Error('Finalized block list is unavailable.');
  const blocks = new Map();
  for (const slot of slots) {
    const block = await connection.getParsedBlock(slot, { commitment:'finalized', transactionDetails:'full', rewards:false,
      maxSupportedTransactionVersion:1 });
    if (!block) throw new Error(`Finalized block ${slot} is unavailable.`);
    blocks.set(slot, block);
  }
  return reverseReplayCommunitySnapshot({ mint:mintAddress, migrationSlot, migrationBlockTime:transaction.blockTime,
    baseSlot, baseAccounts:base.accounts, supplyBaseUnits:String(base.supply), blockSlots:slots, blocks });
}
