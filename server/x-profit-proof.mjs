import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { PublicKey, SystemProgram, ComputeBudgetProgram } from '@solana/web3.js';
import { PUMP_PROGRAM_ID, PUMP_SDK, bondingCurvePda, isSolLikeQuoteMint } from '@pump-fun/pump-sdk';
import { candidateRoundTripTokenAccount, readRoundTripHistory, verifiedClosedRoundTrip } from '../trade-roundtrip.js';

const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const PURPOSE = 'publish-closed-trade-on-x';
const MAX_CHALLENGE_MS = 10 * 60_000;
const PUMP = PUMP_PROGRAM_ID.toBase58();
const TRADE_EVENT = Buffer.from([189, 219, 127, 211, 78, 230, 97, 238]);
const discriminator = name => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
function ensure(condition, message) { if (!condition) throw new Error(message); }
function key(value) { return new PublicKey(value).toBase58(); }
function sig(value) { try { return typeof value === 'string' && value.length <= 88 && bs58.decode(value).length === 64; } catch { return false; } }
function integer(value, label) {
  const text = typeof value === 'number' ? Number.isSafeInteger(value) ? String(value) : '' : value?.toString?.();
  ensure(/^(0|[1-9]\d{0,19})$/.test(text || ''), `${label} must be exact nonnegative base units.`);
  return BigInt(text);
}
function origin(value) {
  const url = new URL(value);
  ensure(url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'A configured HTTPS public origin is required.');
  return url.origin;
}
function consentFields(consent) {
  ensure(consent?.version === 1 && consent.purpose === PURPOSE && consent.cluster === 'devnet', 'Unsupported public-sharing consent purpose or network.');
  ensure(typeof consent.account === 'string' && /^[A-Za-z0-9_]{1,15}$/.test(consent.account), 'Consent requires an exact X account.');
  ensure(typeof consent.challengeId === 'string' && /^[A-Za-z0-9_-]{43}$/.test(consent.challengeId), 'Consent requires a one-use server challenge.');
  for (const name of ['wallet', 'mint']) ensure(typeof consent[name] === 'string' && key(consent[name]) === consent[name], `Invalid consent ${name}.`);
  ensure(sig(consent.buySignature) && sig(consent.sellSignature) && consent.buySignature !== consent.sellSignature, 'Consent requires distinct buy and sell receipts.');
  ensure(origin(consent.origin) === consent.origin, 'Consent origin must be canonical.');
  const issuedAt = Date.parse(consent.issuedAt), expiresAt = Date.parse(consent.expiresAt);
  ensure(Number.isFinite(issuedAt) && Number.isFinite(expiresAt) && new Date(issuedAt).toISOString() === consent.issuedAt
    && new Date(expiresAt).toISOString() === consent.expiresAt && expiresAt > issuedAt && expiresAt - issuedAt <= MAX_CHALLENGE_MS,
  'Consent requires an explicit UTC signing window of at most ten minutes.');
  return { issuedAt, expiresAt };
}

export function xProfitConsentStatement(consent) {
  consentFields(consent);
  return [
    'funded.app public closed-trade sharing consent v1',
    `Purpose: ${PURPOSE}`,
    `Origin: ${consent.origin}`,
    `X account: @${consent.account}`,
    'Network: Solana Devnet (test funds)',
    `Wallet: ${consent.wallet}`,
    `Mint: ${consent.mint}`,
    `Buy receipt: ${consent.buySignature}`,
    `Sell receipt: ${consent.sellSignature}`,
    `Issued at: ${consent.issuedAt}`,
    `Signature acceptance deadline: ${consent.expiresAt}`,
    `Challenge: ${consent.challengeId}`,
    'I authorize one factual public X summary of this exact closed trade after receipt verification. This does not authorize future trades or transactions.',
  ].join('\n');
}

/** The deadline limits challenge acceptance; persisted consent authorizes only this one receipt pair. */
export function validateXProfitConsent(consent, { publicOrigin, xAccount = 'johntrand83', now = Date.now() } = {}) {
  const { issuedAt, expiresAt } = consentFields(consent);
  const acceptedAt = typeof now === 'function' ? now() : now;
  ensure(consent.origin === origin(publicOrigin) && consent.account.toLowerCase() === String(xAccount).toLowerCase(), 'Consent origin or X account does not match this publisher.');
  ensure(Number.isFinite(acceptedAt) && acceptedAt >= issuedAt && acceptedAt < expiresAt, 'Consent signing window has expired or has not begun.');
  ensure(sig(consent.signature) && nacl.sign.detached.verify(new TextEncoder().encode(xProfitConsentStatement(consent)), bs58.decode(consent.signature), new PublicKey(consent.wallet).toBytes()), 'Invalid wallet signature for public sharing.');
  return true;
}

function pumpEvent(transaction, { mint, wallet, side }) {
  const stack = [], matches = [];
  for (const line of transaction.meta?.logMessages || []) {
    ensure(!/log truncated/i.test(line), 'Complete Pump invocation logs are required.');
    const invoke = /^Program ([1-9A-HJ-NP-Za-km-z]+) invoke \[(\d+)\]$/.exec(line);
    if (invoke) { ensure(Number(invoke[2]) === stack.length + 1, 'Invalid program invocation stack.'); stack.push(invoke[1]); continue; }
    const end = /^Program ([1-9A-HJ-NP-Za-km-z]+) (?:success|failed:.*)$/.exec(line);
    if (end) { ensure(stack.pop() === end[1], 'Invalid program completion stack.'); continue; }
    if (stack.at(-1) !== PUMP || !line.startsWith('Program data: ')) continue;
    const bytes = Buffer.from(line.slice(14), 'base64');
    if (!bytes.subarray(0, 8).equals(TRADE_EVENT)) continue;
    let event;
    try { event = PUMP_SDK.decodeTradeEventBc(bytes.subarray(8)); } catch { throw new Error('Unsupported Pump trade event layout.'); }
    ensure(event.mint.toBase58() === mint && event.user.toBase58() === wallet && event.isBuy === (side === 'buy'), 'Pump event does not match the exact wallet, mint and side.');
    matches.push(event);
  }
  ensure(stack.length === 0 && matches.length === 1, 'One complete, authentic Pump trade invocation is required.');
  return matches[0];
}

/** Reject any route whose fees or SOL movements cannot be attributed exactly. */
export function verifyDirectPumpEconomics(transaction, { mint, wallet, signature, side, appFeeRecipient = null }) {
  ensure(['buy', 'sell'].includes(side), 'Unsupported trade side.');
  ensure(transaction?.meta?.err === null && transaction.transaction?.signatures?.includes(signature)
    && Number.isSafeInteger(transaction.slot) && transaction.slot > 0 && Number.isSafeInteger(transaction.blockTime) && transaction.blockTime > 0,
  'A successful finalized trade receipt with a block time is required.');
  const message = transaction.transaction.message;
  const keys = message.accountKeys || [];
  ensure(keys[0]?.signer === true && key(keys[0].pubkey) === wallet, 'The consenting wallet must be the transaction fee payer.');
  const expectedDiscriminator = discriminator(side === 'buy' ? 'buy_v2' : 'sell_v2');
  let pumpInstructions = 0, appFees = 0n;
  for (const instruction of message.instructions || []) {
    const program = key(instruction.programId);
    if (program === ComputeBudgetProgram.programId.toBase58()) continue;
    if (program === SystemProgram.programId.toBase58()) {
      const transfer = instruction.parsed;
      ensure(appFeeRecipient && transfer?.type === 'transfer' && transfer.info?.source === wallet
        && transfer.info.destination === appFeeRecipient && appFeeRecipient !== wallet, 'Unrelated SOL transfer prevents exact profit attribution.');
      appFees += integer(transfer.info.lamports, 'Application fee'); continue;
    }
    ensure(program === PUMP, 'Only direct native-SOL Pump trades without ATA creation or other routes are supported.');
    const data = bs58.decode(instruction.data || '');
    const accounts = (instruction.accounts || []).map(key);
    ensure(Buffer.from(data).subarray(0, 8).equals(expectedDiscriminator) && accounts.includes(wallet)
      && accounts.includes(mint) && accounts.includes(bondingCurvePda(new PublicKey(mint)).toBase58()), 'Pump instruction does not match the expected trade.');
    pumpInstructions += 1;
  }
  ensure(pumpInstructions === 1, 'Exactly one direct Pump trade instruction is required.');
  const event = pumpEvent(transaction, { mint, wallet, side });
  ensure(isSolLikeQuoteMint(event.quoteMint) && !event.mayhemMode && integer(event.cashback ?? 0, 'Cashback') === 0n
    && integer(event.buybackFee ?? 0, 'Buyback fee') === 0n && integer(event.holderRewards ?? 0, 'Holder rewards') === 0n, 'Cashback, mayhem or separate buyback fees require a dedicated cost-basis model.');
  const gross = integer(event.solAmount, 'Gross trade amount');
  ensure(gross > 0n && integer(event.tokenAmount, 'Trade token amount') > 0n, 'Trade amount must be positive.');
  const quote = integer(event.quoteAmount ?? 0, 'Quote amount');
  ensure(quote === 0n || quote === gross, 'Conflicting native-SOL quote amounts.');
  const protocolFees = integer(event.fee, 'Protocol fee') + integer(event.creatorFee, 'Creator fee');
  const networkFees = integer(transaction.meta.fee, 'Transaction fee');
  const fees = protocolFees + networkFees + appFees;
  const before = integer(transaction.meta.preBalances?.[0], 'Wallet pre balance');
  const after = integer(transaction.meta.postBalances?.[0], 'Wallet post balance');
  const delta = after - before;
  ensure(delta === (side === 'buy' ? -gross - fees : gross - fees), 'Rent, rebates or additional SOL movements prevent exact trade attribution.');
  const owned = rows => new Map((rows || []).filter(row => row.owner === wallet).map(row => [`${row.mint}:${row.accountIndex}`, integer(row.uiTokenAmount?.amount, 'Token balance')]));
  const preTokens = owned(transaction.meta.preTokenBalances), postTokens = owned(transaction.meta.postTokenBalances);
  for (const position of new Set([...preTokens.keys(), ...postTokens.keys()])) {
    if (!position.startsWith(`${mint}:`)) ensure((preTokens.get(position) || 0n) === (postTokens.get(position) || 0n), 'Another token asset changed in this transaction.');
  }
  return { grossLamports: gross, feesLamports: fees, walletDeltaLamports: delta, tokenAmount: integer(event.tokenAmount, 'Trade token amount') };
}

/** Read-only collector adapter. Only the authenticated consent endpoint may create these ledger rows. */
export function createXProfitVerifier({ connection, publicOrigin, xAccount = 'johntrand83', appFeeRecipient = null, now = Date.now } = {}) {
  const expectedOrigin = origin(publicOrigin);
  const feeRecipient = appFeeRecipient ? key(appFeeRecipient) : null;
  return async function verifyPublicClosedTrade(row, { state = {} } = {}) {
    const time = typeof now === 'function' ? now() : now;
    const acceptedAt = Date.parse(row.consentedAt);
    ensure(row.cluster === 'devnet' && row.publicConsent === true && row.consentVerified === true
      && Number.isFinite(acceptedAt) && acceptedAt <= time, 'An authenticated, immutable public-sharing consent record is required.');
    validateXProfitConsent(row.consent, { publicOrigin: expectedOrigin, xAccount, now: acceptedAt });
    for (const field of ['wallet', 'mint', 'buySignature', 'sellSignature']) ensure(row[field] === row.consent[field], 'Trade identity differs from the wallet-signed consent.');
    ensure(await connection.getGenesisHash() === DEVNET_GENESIS, 'Profit verification requires Solana Devnet.');
    const { wallet, mint, buySignature, sellSignature } = row;
    const [buy, sell] = await Promise.all([buySignature, sellSignature].map(signature => connection.getParsedTransaction(signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 })));
    const buyEconomics = verifyDirectPumpEconomics(buy, { mint, wallet, signature: buySignature, side: 'buy', appFeeRecipient: feeRecipient });
    const sellEconomics = verifyDirectPumpEconomics(sell, { mint, wallet, signature: sellSignature, side: 'sell', appFeeRecipient: feeRecipient });
    ensure(sell.blockTime * 1000 <= acceptedAt, 'Consent cannot precede the completed trade.');
    const tokenAccount = candidateRoundTripTokenAccount(buy, wallet, mint);
    ensure(tokenAccount, 'A single initially empty token-account position is required.');
    const accountHistory = await readRoundTripHistory(connection, tokenAccount, buySignature, sellSignature);
    const closed = verifiedClosedRoundTrip({ buy, sell, wallet, mint, buySignature, sellSignature, accountHistory });
    ensure(buyEconomics.tokenAmount === BigInt(closed.tokensRaw) && sellEconomics.tokenAmount === buyEconomics.tokenAmount, 'Pump events do not match the complete closed token position.');
    const fees = buyEconomics.feesLamports + sellEconomics.feesLamports;
    ensure(sellEconomics.grossLamports - buyEconomics.grossLamports - fees === BigInt(closed.netLamports), 'Closed trade accounting does not conserve SOL.');
    const proofs = [buy, sell].map((tx, index) => ({ signature: index === 0 ? buySignature : sellSignature, slot: tx.slot, cluster: 'devnet', commitment: 'finalized', verified: true }));
    return { wallet, mint, name: state.launches?.[mint]?.name || state.listings?.[mint]?.name || 'Token', occurredAt: new Date(sell.blockTime * 1000).toISOString(),
      publicConsent: true, completeCostBasis: true, positionClosed: true, buyCostLamports: buyEconomics.grossLamports.toString(),
      sellProceedsLamports: sellEconomics.grossLamports.toString(), feesLamports: fees.toString(), proofs, scope: 'direct-native-SOL-Pump-closed-position' };
  };
}
