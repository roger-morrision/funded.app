import { verifiedTradeReceipt } from './trade-share-proof.js';

function keyAt(transaction, index) {
  const entry = transaction.transaction?.message?.accountKeys?.[index];
  return entry ? String(entry.pubkey || entry) : '';
}

function tokenPosition(transaction, wallet, mint) {
  if (!transaction?.meta || !transaction.transaction?.message) return null;
  const balances = [...(transaction.meta?.preTokenBalances || []), ...(transaction.meta?.postTokenBalances || [])]
    .filter(entry => entry.owner === wallet && entry.mint === mint);
  const indices = [...new Set(balances.map(entry => entry.accountIndex))];
  if (indices.length !== 1 || !Number.isInteger(indices[0])) return null;
  const accountIndex = indices[0];
  const tokenAccount = keyAt(transaction, accountIndex);
  if (!tokenAccount) return null;
  const amount = rows => {
    const entry = rows?.find(row => row.accountIndex === accountIndex && row.owner === wallet && row.mint === mint);
    return BigInt(entry?.uiTokenAmount?.amount || '0');
  };
  return { tokenAccount, pre:amount(transaction.meta.preTokenBalances), post:amount(transaction.meta.postTokenBalances) };
}

function walletSolDelta(transaction, wallet) {
  const index = transaction.transaction?.message?.accountKeys?.findIndex(entry => String(entry.pubkey || entry) === wallet && entry.signer === true);
  if (index < 0) throw new Error('The wallet did not sign the trade.');
  const pre = transaction.meta?.preBalances?.[index], post = transaction.meta?.postBalances?.[index];
  if (!Number.isSafeInteger(pre) || !Number.isSafeInteger(post)) throw new Error('Wallet SOL balances are unavailable.');
  return BigInt(post) - BigInt(pre);
}

export function verifiedClosedRoundTrip({ buy, sell, wallet, mint, buySignature, sellSignature, accountHistory }) {
  if (!verifiedTradeReceipt(buy, { wallet, mint, side:'buy', signature:buySignature })
    || !verifiedTradeReceipt(sell, { wallet, mint, side:'sell', signature:sellSignature })) throw new Error('Both finalized trade receipts must match this wallet and mint.');
  if (!Number.isInteger(buy.slot) || !Number.isInteger(sell.slot) || buy.slot >= sell.slot) throw new Error('The buy must precede the sell.');
  const bought = tokenPosition(buy, wallet, mint), sold = tokenPosition(sell, wallet, mint);
  if (!bought || !sold || bought.tokenAccount !== sold.tokenAccount || bought.pre !== 0n
    || bought.post <= 0n || sold.pre !== bought.post || sold.post !== 0n) throw new Error('The receipts do not close one exact token-account position.');
  if (!Array.isArray(accountHistory) || accountHistory.length !== 2 || accountHistory[0] !== sellSignature || accountHistory[1] !== buySignature) throw new Error('Intervening token-account activity prevents a complete round-trip result.');
  const netLamports = walletSolDelta(buy, wallet) + walletSolDelta(sell, wallet);
  return { verified:true, wallet, mint, tokenAccount:bought.tokenAccount, buySignature, sellSignature,
    tokensRaw:bought.post.toString(), netLamports:netLamports.toString(), positive:netLamports > 0n,
    scope:'wallet SOL balance change in two finalized trade receipts; includes all SOL movements in those transactions' };
}

export function candidateRoundTripTokenAccount(buy, wallet, mint) {
  const position = tokenPosition(buy, wallet, mint);
  return position?.pre === 0n && position.post > 0n ? position.tokenAccount : null;
}

export function candidateRoundTripWallet(buy, sell, mint) {
  if (!buy?.meta || !sell?.meta) return null;
  const owners = transaction => new Set([...(transaction.meta.preTokenBalances || []), ...(transaction.meta.postTokenBalances || [])]
    .filter(entry => entry.mint === mint && entry.owner).map(entry => entry.owner));
  const buyOwners = owners(buy), sellOwners = owners(sell);
  const signed = transaction => new Set((transaction.transaction?.message?.accountKeys || [])
    .filter(entry => entry.signer === true).map(entry => String(entry.pubkey || entry)));
  const sellSigners = signed(sell);
  const matches = [...signed(buy)].filter(address => buyOwners.has(address) && sellOwners.has(address) && sellSigners.has(address));
  return matches.length === 1 ? matches[0] : null;
}

export function formatLamportsAsSol(value) {
  const lamports = BigInt(value);
  const sign = lamports < 0n ? '-' : '';
  const absolute = lamports < 0n ? -lamports : lamports;
  const whole = absolute / 1_000_000_000n;
  const fraction = (absolute % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return `${sign}${whole}${fraction ? `.${fraction}` : ''}`;
}

export async function readRoundTripHistory(connection, tokenAccount, buySignature, sellSignature, { maxPages = 10 } = {}) {
  const { PublicKey } = await import('@solana/web3.js');
  const address = new PublicKey(tokenAccount);
  let before, foundSell = false;
  const between = [];
  for (let page = 0; page < maxPages; page += 1) {
    const rows = await connection.getSignaturesForAddress(address, { limit:100, ...(before ? { before } : {}) }, 'finalized');
    if (!rows.length) break;
    for (const row of rows) {
      if (!foundSell) { if (row.signature === sellSignature) { foundSell = true; between.push(row.signature); } continue; }
      between.push(row.signature);
      if (row.signature === buySignature) return between;
    }
    if (rows.length < 100) break;
    before = rows.at(-1).signature;
  }
  throw new Error('Complete token-account history between these receipts is unavailable.');
}

export async function verifyRoundTripFromSignatures(connection, { buySignature, sellSignature, mint, wallet = null }) {
  const [buy, sell] = await Promise.all([buySignature, sellSignature].map(signature => connection.getParsedTransaction(signature, { commitment:'finalized', maxSupportedTransactionVersion:0 })));
  const owner = wallet || candidateRoundTripWallet(buy, sell, mint);
  if (!owner) throw new Error('A single signing wallet could not be identified from both receipts.');
  const account = candidateRoundTripTokenAccount(buy, owner, mint);
  if (!account) throw new Error('The buy receipt does not open one verifiable token account.');
  const accountHistory = await readRoundTripHistory(connection, account, buySignature, sellSignature);
  return verifiedClosedRoundTrip({ buy, sell, wallet:owner, mint, buySignature, sellSignature, accountHistory });
}
