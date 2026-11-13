import { WSOL_MINT } from '../shared/pair-label.js';

// "Create a coin paired with anything": a pump.fun coin whose bonding curve is
// quoted in a token Pump accepts (SOL, USDC, xStocks, stocks, crypto). The
// creator's wallet signs and is Pump's creator; nothing is sent before review.
const NAME_MAX = 32, SYMBOL_MAX = 10, IMAGE_MAX = 600_000;
let status = null;

async function launchStatus(app) {
  status ||= app.apiRequest('/api/pair-launch/status').then(result => result?.available ? result.data : { enabled: false }).catch(() => ({ enabled: false }));
  return status;
}

// Launch a coin paired with `quote` ({ mint, symbol }); used by this dialog and
// by step 1 of the main launch form. Throws with a readable message.
export async function launchPairedCoin(app, input, say = () => {}) {
  const name = String(input.name || '').trim(), symbol = String(input.symbol || '').trim().replace(/^\$/, '').toUpperCase();
  const image = input.image, quote = input.quote || { mint: WSOL_MINT, symbol: 'SOL' };
  if (!name || name.length > NAME_MAX) throw new Error(`Enter a name up to ${NAME_MAX} characters.`);
  if (!/^[A-Z0-9]{1,10}$/.test(symbol)) throw new Error('Enter a ticker of up to 10 letters or digits.');
  if (!(image instanceof Blob) || !image.size) throw new Error('Choose an image for your coin.');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(image.type) || image.size > IMAGE_MAX) throw new Error('Choose a PNG, JPG or WEBP image under 600 KB.');
  const firstBuySol = quote.mint === WSOL_MINT ? Math.max(0, Number(input.firstBuySol || 0)) : 0;
  if (!(await launchStatus(app)).enabled) throw new Error('Paired launches are not open on this network yet.');
  if (!app.wallet) await app.connectWallet();
  const session = app.captureWalletSession?.();
  if (!session?.provider?.signMessage || !app.canSignTransactions?.(session.provider)) throw new Error('Connect a wallet that can sign messages and transactions.');
  const [{ Keypair }, { buildPairLaunchTransaction }] = await Promise.all([import('@solana/web3.js'), import('./pair-launch-tx.js')]);
  const connection = app.connection || (await app.getSolana(), app.connection);
  const mint = Keypair.generate();
  // 1. Public metadata (name, ticker, image, links), signed by the creator's wallet.
  say('Sign the coin details in your wallet…');
  const bytes = new Uint8Array(await image.arrayBuffer());
  const imageSha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  const link = (value, kind) => { const text = String(value || '').trim(); return text ? app.canonicalLaunchSocialUrl?.(text, kind) || text : ''; };
  const record = { mint: mint.publicKey.toBase58(), creatorWallet: session.address, name, symbol, cluster: app.APP_CLUSTER || 'devnet',
    description: String(input.description || '').trim(), tagline: '', roadmap: '', website: link(input.website, 'website'), x: link(input.x, 'x'),
    telegram: link(input.telegram, 'telegram'), discord: '', imageSha256 };
  const signed = await session.provider.signMessage(new TextEncoder().encode(app.metadataStatement(record)));
  app.assertWalletSessionCurrent?.(session);
  say('Publishing coin details…');
  const published = await app.apiRequest('/api/token-metadata', { method: 'POST', body: { ...record, imageBase64: app.Buffer.from(bytes).toString('base64'), imageType: image.type,
    bannerBase64: '', bannerType: '', signature: app.bs58.encode(signed.signature || signed) } });
  if (!published?.available || !published.data?.uri) throw new Error(published?.data?.error || 'Coin details could not be published. Nothing was sent.');
  // 2. One transaction: create the coin on pump.fun, paired with the chosen token.
  say(`Approve creating $${symbol} paired with ${quote.symbol} in your wallet…`);
  const built = await buildPairLaunchTransaction({ connection, user: session.provider.publicKey, mint: mint.publicKey, name, symbol, uri: published.data.uri,
    quoteMint: quote.mint, firstBuySol });
  built.transaction.partialSign(mint);
  app.assertWalletSessionCurrent?.(session);
  // Wallets that only sign (no sign-and-send) are signed here and sent through the RPC.
  const sent = typeof session.provider.signAndSendTransaction === 'function' && !session.provider.remoteMobile
    ? await session.provider.signAndSendTransaction(built.transaction, { skipPreflight: false, preflightCommitment: 'confirmed' })
    : await connection.sendRawTransaction((await session.provider.signTransaction(built.transaction)).serialize(), { skipPreflight: false, preflightCommitment: 'confirmed' });
  const signature = typeof sent === 'string' ? sent : sent?.signature;
  if (!signature) throw new Error('Your wallet did not return a transaction signature. Check your wallet activity.');
  say('Confirming on Solana…');
  // A slow RPC can report an expired blockhash for a transaction that did land;
  // the signature status decides.
  const confirmation = await connection.confirmTransaction({ signature, blockhash: built.transaction.recentBlockhash, lastValidBlockHeight: built.lastValidBlockHeight }, 'confirmed')
    .catch(async error => {
      const { value } = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
      if (value && !value.err && ['confirmed', 'finalized'].includes(value.confirmationStatus)) return { value: { err: null } };
      throw new Error(`The launch was not confirmed on Solana. Check your wallet before retrying. Transaction: ${signature}${/expired/i.test(error?.message || '') ? ' (expired)' : ''}`);
    });
  if (confirmation?.value?.err) throw new Error('The launch transaction failed on Solana. Nothing was created.');
  // A first buy that did not fit the create transaction follows as a normal buy.
  if (built.deferredBuySol > 0) {
    say(`Coin created. Approve your ${built.deferredBuySol} SOL first buy…`);
    await import('../trade/quick-buy.js').then(module => module.quickBuy(app, { mint: record.mint, amountSol: built.deferredBuySol, symbol })).catch(() => {});
  }
  // 3. List it on richpad.fun after the server checks the coin on-chain.
  say('Listing your coin on richpad.fun…');
  await app.apiRequest('/api/pair-launch/record', { method: 'POST', body: { mint: record.mint, signature, name, symbol } }).catch(() => null);
  say('');
  app.showToast?.(`$${symbol} is live on pump.fun, paired with ${quote.symbol}.`);
  location.assign(`/token/${encodeURIComponent(record.mint)}`);
  return { mint: record.mint, signature };
}


export { launchStatus as pairLaunchStatus };
