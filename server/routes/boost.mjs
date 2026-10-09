import { PublicKey, Connection } from '@solana/web3.js';
import { activeBoosts, BOOST_PACKAGES, boostPackage, boostLamports, boostMemo } from '../../boost-offer.js';
import { allowedAuthOrigin } from '../x-auth.mjs';
import { DEVNET_GENESIS_HASH } from '../automatic-reward-chain.mjs';
import { verifyBoostPayment } from '../boost-proof.mjs';

// Called after the shared request policy, rate limit, and authorization checks.
// Return true only after sending a response; false lets the router continue.
export function createBoostRoutes({
  store, solanaCluster, boostPurchasesEnabled, clientKey, body, readSolUsdQuote, id, solanaRpcUrl,
  respond,
}) {

  const json = (...args) => { respond(...args); return true; };
  return async function handleBoostRoutes(req, res, url, requestId) {
    if (req.method === 'GET' && url.pathname === '/api/boosts') {
      const state = await store.read();
      const mint = url.searchParams.get('mint');
      if (mint) {
        try { if (new PublicKey(mint).toBase58() !== mint) throw new Error(); }
        catch { return json(res, 400, { error:'A valid token mint is required.' }); }
      }
      const active = activeBoosts(state.boostReceipts);
      const history = mint ? Object.values(state.boostReceipts || {}).filter(row => row.mint === mint)
        .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt)).slice(0, 30) : [];
      return json(res, 200, { cluster:solanaCluster, enabled:boostPurchasesEnabled && Boolean(process.env.FUNDED_BOOST_PAYMENT_WALLET), packages:BOOST_PACKAGES, active:mint ? (active[mint] ? { [mint]:active[mint] } : {}) : active, history });
    }
    if (req.method === 'POST' && url.pathname === '/api/boosts/quote') {
      if (solanaCluster !== 'devnet') return json(res, 403, { error:'Boost payments are available on Solana only.' });
      if (!boostPurchasesEnabled) return json(res, 503, { error:'New boost purchases are currently paused.' });
      if (!allowedAuthOrigin(req, process.env.CORS_ORIGIN)) return json(res, 403, { error:'Start boost checkout from funded.vip.' });
      if (!await store.chargeRpcRate(`boost-quote:${clientKey(req)}`, 1, 8, Math.floor(Date.now() / 60_000) * 60_000))
        return json(res, 429, { error:'Too many boost quotes; retry shortly.' });
      const input = await body(req);
      let mint, payer, recipient;
      try {
        mint = new PublicKey(String(input.mint || '')).toBase58();
        payer = new PublicKey(String(input.payer || '')).toBase58();
      } catch { return json(res, 400, { error:'Enter a valid token mint and paying wallet before requesting a boost quote.' }); }
      try { recipient = new PublicKey(String(process.env.FUNDED_BOOST_PAYMENT_WALLET || '')).toBase58(); }
      catch { return json(res, 503, { error:'The Devnet boost payment address is not configured. No payment was requested.' }); }
      if (mint !== input.mint || payer !== input.payer || payer === recipient) return json(res, 400, { error:'A valid token mint and distinct paying wallet are required.' });
      const selected = boostPackage(input.packageId);
      if (!selected) return json(res, 400, { error:'Choose a supported boost package.' });
      const state = await store.read();
      const launch = state.launches?.[mint];
      const listing = state.listings?.[mint];
      if (!(launch?.onchainVerified && launch.cluster === 'devnet') && !(listing?.onchainVerified && listing.cluster === 'devnet'))
        return json(res, 404, { error:'Only verified tokens in the funded.vip Solana directory can be boosted.' });
      const price = await readSolUsdQuote();
      if (!price || Date.now() - Date.parse(price.fetchedAt) > 120_000)
        return json(res, 503, { error:'A fresh SOL/USD quote is unavailable. No payment was requested.' });
      const now = Date.now();
      const quote = { id:id('boost'), mint, payer, recipient, packageId:selected.id, multiplier:selected.multiplier,
        hours:selected.hours, usd:selected.usd, solUsd:price.priceUsd, lamports:boostLamports(selected.usd, price.priceUsd),
        cluster:'devnet', createdAt:new Date(now).toISOString(), expiresAt:new Date(now + 5 * 60_000).toISOString() };
      await store.update(current => {
        current.boostQuotes ||= {};
        for (const [key, old] of Object.entries(current.boostQuotes))
          if (Date.parse(old.expiresAt) < now - 48 * 3_600_000) delete current.boostQuotes[key];
        current.boostQuotes[quote.id] = quote;
      });
      return json(res, 201, { ...quote, memo:boostMemo(quote.id) });
    }
    if (req.method === 'POST' && url.pathname === '/api/boosts/confirm') {
      if (solanaCluster !== 'devnet') return json(res, 403, { error:'Boost payments are available on Solana only.' });
      if (!allowedAuthOrigin(req, process.env.CORS_ORIGIN)) return json(res, 403, { error:'Confirm boost checkout from funded.vip.' });
      const input = await body(req);
      const quoteId = String(input.quoteId || '');
      const signature = String(input.signature || '');
      if (!/^boost_\d+_[0-9a-f]{16}$/.test(quoteId) || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature))
        return json(res, 400, { error:'A valid boost quote and Solana signature are required.' });
      const state = await store.read();
      const existing = state.boostReceipts?.[signature];
      if (existing) return existing.quoteId === quoteId ? json(res, 200, existing) : json(res, 409, { error:'This transaction was already used.' });
      const quote = state.boostQuotes?.[quoteId];
      if (!quote) return json(res, 404, { error:'Boost quote was not found.' });
      const rpc = new Connection(solanaRpcUrl, { commitment:'finalized', disableRetryOnRateLimit:true,
        fetch:(url, options) => fetch(url, { ...options, signal:AbortSignal.timeout(8000) }) });
      let transaction;
      try {
        if (await rpc.getGenesisHash() !== DEVNET_GENESIS_HASH) return json(res, 503, { error:'The configured RPC failed verification.' });
        transaction = await rpc.getParsedTransaction(signature, { commitment:'finalized', maxSupportedTransactionVersion:0 });
      } catch { return json(res, 503, { error:'Finalized Solana payment proof is currently unavailable. Retry the same signature.' }); }
      if (!transaction) return json(res, 202, { status:'pending', signature, message:'Payment is not finalized yet. Retry verification with the same signature.' });
      if (transaction.transaction?.signatures?.[0] !== signature || !Number.isSafeInteger(transaction.slot) || transaction.slot < 1)
        return json(res, 503, { error:'Finalized payment proof did not match the requested signature. Retry verification of the same payment.' });
      if (transaction.meta?.err != null) return json(res, 200, { status:'failed', signature, quoteId,
        cluster:'devnet', commitment:'finalized', slot:transaction.slot });
      let proof;
      try { proof = verifyBoostPayment(transaction, quote); }
      catch (error) { return json(res, 409, { error:error.message || 'Payment does not match this boost quote.' }); }
      const record = { signature, quoteId, mint:quote.mint, payer:quote.payer, recipient:quote.recipient,
        packageId:quote.packageId, multiplier:quote.multiplier, hours:quote.hours, usd:quote.usd,
        solUsd:quote.solUsd, lamports:quote.lamports, cluster:'devnet', status:'finalized',
        slot:proof.slot, startsAt:proof.startsAt, expiresAt:proof.expiresAt };
      try {
        const saved = await store.update(current => {
          current.boostReceipts ||= {};
          if (current.boostReceipts[signature]) {
            if (current.boostReceipts[signature].quoteId !== quoteId) throw Object.assign(new Error('This transaction was already used.'), { statusCode:409 });
            return current.boostReceipts[signature];
          }
          if (Object.values(current.boostReceipts).some(row => row.quoteId === quoteId)) throw Object.assign(new Error('This boost quote was already paid.'), { statusCode:409 });
          if (JSON.stringify(current.boostQuotes?.[quoteId]) !== JSON.stringify(quote)) throw Object.assign(new Error('Boost quote changed during verification.'), { statusCode:409 });
          current.boostReceipts[signature] = record;
          return record;
        });
        return json(res, saved === record ? 201 : 200, saved);
      } catch (error) {
        if (error.statusCode === 409) return json(res, 409, { error:error.message });
        console.error(JSON.stringify({ event:'boost_receipt_storage_failure', requestId }));
        return json(res, 503, { error:'The payment receipt could not be saved. Retry verification with the same signature; do not pay again.', requestId });
      }
    }
    return false;
  };
}
