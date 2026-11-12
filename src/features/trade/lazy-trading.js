// Load transaction SDKs only when a market read or trade needs them.
// Mainnet: Pump.fun tokens (bonding curve or canonical PumpSwap pool) trade
// directly through the Pump SDK, with no aggregator rate limit; anything the
// direct path cannot build (other DEXs, legacy migrations) routes through Jupiter.
const MAINNET = import.meta.env?.VITE_SOLANA_CLUSTER === 'mainnet-beta';
const pumpCandidate = mint => /pump$/.test(String(mint?.toBase58?.() ?? mint ?? ''));
const pumpSdk = () => import('../../../pump-trading.js');
const jupiterSdk = () => import('../../../jupiter-trading.js');

export async function buildTradeTransaction(...args) {
  if (!MAINNET) return (await pumpSdk()).buildTradeTransaction(...args);
  if (pumpCandidate(args[0]?.mint)) {
    try { return await (await pumpSdk()).buildTradeTransaction(args[0]); } catch { /* fall back to Jupiter routing */ }
  }
  return (await jupiterSdk()).buildJupiterTrade(args[0]);
}
export async function buildVerifiedPoolTradeTransaction(...args) { const sdk = await import('../../../pump-trading.js'); return sdk.buildVerifiedPoolTradeTransaction(...args); }
export async function fetchVerifiedPoolBuyQuote(...args) { const sdk = await import('../../../pump-trading.js'); return sdk.fetchVerifiedPoolBuyQuote(...args); }
export async function fetchBondingCurveSnapshot(...args) { const sdk = await import('../../../pump-trading.js'); return sdk.fetchBondingCurveSnapshot(...args); }
export async function fetchGraduatedPoolSnapshot(...args) { const sdk = await import('../../../pump-trading.js'); return sdk.fetchGraduatedPoolSnapshot(...args); }
export async function fetchVerifiedPoolSnapshot(...args) { const sdk = await import('../../../pump-trading.js'); return sdk.fetchVerifiedPoolSnapshot(...args); }
// Mainnet wallets (Phantom) add guard instructions when signing; let the wallet
// sign and send the exact instructions we built, then confirm on-chain.
async function submitPumpViaWallet(input, prepared) {
  const { Transaction } = await import('@solana/web3.js');
  const { waitForSignatureConfirmation } = await import('../../../funded-burn.js');
  const { connection, provider, onStatus = () => {}, onPrepared = () => {}, assertWalletCurrent = () => {} } = input;
  if (prepared.side !== input.side || prepared.inputAmount !== Number(input.amount)) throw Error('The trade quote no longer matches the selected trade.');
  onStatus('Waiting for wallet approval…');
  const latest = await connection.getLatestBlockhash('confirmed');
  const transaction = new Transaction({ recentBlockhash: latest.blockhash, feePayer: prepared.user }).add(...prepared.instructions);
  assertWalletCurrent();
  const sent = await provider.signAndSendTransaction(transaction, { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 2 });
  assertWalletCurrent();
  const signature = typeof sent === 'string' ? sent : typeof sent?.signature === 'string' ? sent.signature : null;
  if (!signature) throw Error('Wallet did not return a trade signature. Check your wallet activity before retrying.');
  const lastValidBlockHeight = latest.lastValidBlockHeight;
  await onPrepared({ signature, lastValidBlockHeight, blockhash: latest.blockhash });
  onStatus('Confirming trade on Solana…');
  try {
    const confirmation = await waitForSignatureConfirmation(connection, { signature, lastValidBlockHeight, commitment: 'confirmed', pollIntervalMs: 1500 });
    if (!confirmation?.value || confirmation.value.err) throw Error(`Trade did not confirm successfully${confirmation?.value?.err ? `: ${JSON.stringify(confirmation.value.err)}` : '.'}`);
  } catch (error) { error.signature = signature; error.lastValidBlockHeight = lastValidBlockHeight; throw error; }
  return { ...prepared, signature, lastValidBlockHeight, confirmedAt: new Date().toISOString() };
}
const walletSends = provider => typeof provider?.signAndSendTransaction === 'function' && !provider.remoteMobile;

export async function submitTrade(...args) {
  if (!MAINNET) return (await pumpSdk()).submitTrade(...args);
  const input = args[0] || {};
  if (input.preparedTrade && input.preparedTrade.route !== 'jupiter')
    return walletSends(input.provider) ? submitPumpViaWallet(input, input.preparedTrade) : (await pumpSdk()).submitTrade(input);
  if (!input.preparedTrade && pumpCandidate(input.mint)) {
    // Build before any signing, so a failed direct build can still fall back safely.
    let prepared = null;
    try { prepared = await (await pumpSdk()).buildTradeTransaction(input); } catch { prepared = null; }
    if (prepared) return walletSends(input.provider) ? submitPumpViaWallet(input, prepared) : (await pumpSdk()).submitTrade({ ...input, preparedTrade: prepared });
  }
  return (await jupiterSdk()).submitJupiterTrade(input);
}
export async function fetchRichMarketSnapshot(...args) { const sdk = await import('../../../rich-market.js'); return sdk.fetchRichMarketSnapshot(...args); }
export async function buildRichTradeTransaction(...args) { const sdk = await import('../../../rich-market.js'); return sdk.buildRichTradeTransaction(...args); }
export async function fetchRichBuyQuote(...args) { const sdk = await import('../../../rich-market.js'); return sdk.fetchRichBuyQuote(...args); }
