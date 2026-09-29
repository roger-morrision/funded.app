import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Transaction } from '@solana/web3.js';
import { inspectPhantomTradeTransaction } from '../phantom-mobile-crypto.js';
import { renderTradeSignerPage } from './trade-signer-page.mjs';

const FLOW_ID = /^[a-f0-9]{48}$/;
const POLL_TOKEN = /^[a-f0-9]{64}$/;
const B58 = /^[1-9A-HJ-NP-Za-km-z]+$/;
const SIGNATURE_B64 = /^[A-Za-z0-9+/]{86}==$/;
const MAX_FLOWS = 256;
const FLOW_TTL_MS = 5 * 60_000;
const TRADE_RESULT_TTL_MS = 15 * 60_000;
const WEB3_BROWSER_SCRIPT = readFileSync(new URL('../node_modules/@solana/web3.js/lib/index.iife.min.js', import.meta.url));

function validTradeSummary(summary) {
  if (!summary || !['buy', 'sell'].includes(summary.side)) return false;
  const amount = value => typeof value === 'string' && value.length <= 32 && /^\d+(?:\.\d{1,9})?$/.test(value) && Number.isFinite(Number(value)) && Number(value) >= 0;
  if (typeof summary.mint !== 'string' || !B58.test(summary.mint) || bs58.decode(summary.mint).length !== 32
    || typeof summary.tokenName !== 'string' || !summary.tokenName.trim() || summary.tokenName.length > 80 || /[\x00-\x1f<>]/.test(summary.tokenName)
    || typeof summary.tokenSymbol !== 'string' || !summary.tokenSymbol.trim() || summary.tokenSymbol.length > 16 || /[\x00-\x1f<>]/.test(summary.tokenSymbol)
    || !amount(summary.tokenAmount) || Number(summary.tokenAmount) <= 0 || !amount(summary.appFeeSol)) return false;
  if (summary.side === 'sell') return amount(summary.expectedSol) && amount(summary.minimumSol) && Number(summary.expectedSol) >= Number(summary.minimumSol) && Number(summary.minimumSol) > 0;
  if (!amount(summary.spendSol) || !amount(summary.maximumSpendSol) || !amount(summary.targetTotalSol) || !amount(summary.maximumTotalSol)
    || Number(summary.spendSol) <= 0 || !amount(summary.minimumTokenAmount) || Number(summary.tokenAmount) < Number(summary.minimumTokenAmount)) return false;
  const lamports = value => { const [whole, fraction = ''] = value.split('.'); return BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, '0') || '0'); };
  return lamports(summary.maximumSpendSol) >= lamports(summary.spendSol)
    && lamports(summary.targetTotalSol) === lamports(summary.spendSol) + lamports(summary.appFeeSol)
    && lamports(summary.maximumTotalSol) === lamports(summary.maximumSpendSol) + lamports(summary.appFeeSol);
}

function finalizedTradeOutcome(transaction, wallet, mint) {
  if (!transaction?.meta || !transaction?.transaction?.message?.accountKeys) return null;
  if (transaction.meta.err) return { state:'failed', slot:transaction.slot, error:'The Devnet transaction finalized with an error.' };
  const keys = transaction.transaction.message.accountKeys;
  const walletIndex = keys.findIndex(key => String(key.pubkey || key) === wallet);
  if (walletIndex < 0) return { state:'failed', slot:transaction.slot, error:'The finalized transaction did not contain the expected wallet.' };
  const solDeltaLamports = BigInt(transaction.meta.postBalances[walletIndex]) - BigInt(transaction.meta.preBalances[walletIndex]);
  const tokenAmount = balances => (balances || []).filter(balance => balance.owner === wallet && balance.mint === mint)
    .reduce((total, balance) => total + BigInt(balance.uiTokenAmount.amount), 0n);
  const tokenBalances = [...(transaction.meta.postTokenBalances || []), ...(transaction.meta.preTokenBalances || [])].filter(balance => balance.owner === wallet && balance.mint === mint);
  return {
    state:'finalized', slot:transaction.slot, solDeltaLamports:String(solDeltaLamports),
    ...(mint ? { tokenDeltaRaw:String(tokenAmount(transaction.meta.postTokenBalances) - tokenAmount(transaction.meta.preTokenBalances)), tokenDecimals:tokenBalances[0]?.uiTokenAmount?.decimals ?? null } : {}),
  };
}

function reply(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(data));
}

function tradeSignatureFailure(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function tradeInstructionDifference(expected, actual) {
  const programs = transaction => transaction.instructions.map(instruction => instruction.programId.toBase58());
  return {
    feePayerChanged: !expected.feePayer?.equals(actual.feePayer),
    blockhashChanged: expected.recentBlockhash !== actual.recentBlockhash,
    expectedPrograms: programs(expected),
    actualPrograms: programs(actual),
    firstChangedInstruction: expected.instructions.findIndex((instruction, index) => {
      const other = actual.instructions[index];
      return !other || !instruction.programId.equals(other.programId)
        || !Buffer.from(instruction.data).equals(Buffer.from(other.data))
        || instruction.keys.length !== other.keys.length
        || instruction.keys.some((key, keyIndex) => !key.pubkey.equals(other.keys[keyIndex].pubkey)
          || key.isSigner !== other.keys[keyIndex].isSigner || key.isWritable !== other.keys[keyIndex].isWritable);
    }),
  };
}

const TRADE_SIGNATURE_ERRORS = Object.freeze({
  'invalid-encoding':'Phantom returned an unreadable signed transaction. Nothing was submitted.',
  'blockhash-changed':'Phantom changed the Devnet blockhash during signing. Nothing was submitted.',
  'fee-payer-changed':'Phantom changed the trade fee payer during signing. Nothing was submitted.',
  'instructions-changed':'Phantom changed the trade instructions during signing. Nothing was submitted.',
  'unsafe-compute-budget':'Phantom added an unsupported compute-budget instruction. Nothing was submitted.',
  'priority-fee-too-high':'Phantom added a priority fee above the Devnet safety limit. Nothing was submitted.',
  'wallet-signature-missing':'Phantom did not sign with the connected wallet. Nothing was submitted.',
  'wallet-signature-invalid':'The connected wallet signature did not verify. Nothing was submitted.',
  'other-signature-invalid':'The returned transaction has an invalid or missing additional signature. Nothing was submitted.',
});

function signerPage(id) {
  const nonce = randomBytes(18).toString('base64');
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign funded.vip claim</title><style>body{font:16px system-ui;max-width:34rem;margin:3rem auto;padding:0 1.25rem;background:#15121f;color:#fff}button{font:inherit;padding:.9rem 1.2rem;border:0;border-radius:.7rem;background:#b4a3ff;color:#171125}code{overflow-wrap:anywhere}p{line-height:1.5;color:#d4cce5}</style><h1>Sign your Devnet claim</h1><p>This page asks Phantom to sign the exact claim message. The funded.vip desktop tab will receive the result.</p><p>Expected wallet: <code id="wallet">Loading…</code></p><p>Message: <code id="message">Loading…</code></p><button id="sign" disabled>Connect and sign in Phantom</button><p id="status" role="status">Loading request…</p><script nonce="${nonce}">
const id='${id}';
const status=document.querySelector('#status');
const button=document.querySelector('#sign');
let request;
fetch('/api/mobile-wallet/sign-request/'+id,{cache:'no-store'}).then(async response=>{if(!response.ok)throw new Error('Signing request expired. Start again on the desktop.');request=await response.json();document.querySelector('#wallet').textContent=request.publicKey;document.querySelector('#message').textContent=request.message;button.disabled=false;status.textContent='Review the wallet and message, then tap Connect and sign.'}).catch(error=>status.textContent=error.message);
button.addEventListener('click',async()=>{button.disabled=true;try{const provider=window.phantom?.solana||window.solana;if(!provider?.signMessage)throw new Error('Open this page inside Phantom on your phone.');const connected=await provider.connect();const address=String(connected?.publicKey||provider.publicKey||'');if(address!==request.publicKey)throw new Error('Wrong wallet selected. Switch Phantom to '+request.publicKey+' and try again.');status.textContent='Approve the message in Phantom…';const signed=await provider.signMessage(new TextEncoder().encode(request.message),'utf8');const bytes=signed.signature||signed;if(!bytes||bytes.length!==64)throw new Error('Phantom did not return a valid signature.');const signature= btoa(Array.from(bytes,byte=>String.fromCharCode(byte)).join(''));const response=await fetch('/api/mobile-wallet/sign/'+id,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({signature})});if(!response.ok)throw new Error((await response.json()).error||'Could not send the signature to the desktop.');status.textContent='Signature received. Return to the funded.vip desktop tab.'}catch(error){status.textContent=error.message||'Signing failed.';button.disabled=false}});
  </script></html>`;
  return { html, nonce };
}

export function createMobileWalletRelay({ appOrigin, now = Date.now, getLatestBlockhash = null, getFinalizedTransaction = null } = {}) {
  if (!appOrigin || new URL(appOrigin).origin !== appOrigin) throw new Error('A fixed app origin is required for mobile wallet callbacks.');
  const flows = new Map();
  const sweep = () => {
    for (const [id, flow] of flows) if (flow.expiresAt <= now()) flows.delete(id);
  };
  return {
    async handle(req, res, url, readBody) {
      const register = url.pathname === '/api/mobile-wallet/relay';
      const match = url.pathname.match(/^\/api\/mobile-wallet\/(callback|relay)\/([a-f0-9]{48})$/);
      const sign = url.pathname.match(/^\/api\/mobile-wallet\/(sign|sign-request)\/([a-f0-9]{48})$/);
      const linkRoute = url.pathname.match(/^\/api\/mobile-wallet\/(link|open)\/([a-f0-9]{48})$/);
      const trade = url.pathname.match(/^\/api\/mobile-wallet\/(trade|trade-request|trade-refresh)\/([a-f0-9]{48})$/);
      const tradeStatus = url.pathname.match(/^\/api\/mobile-wallet\/trade-status\/([a-f0-9]{48})$/);
      const browserScript = url.pathname === '/api/mobile-wallet/web3.js';
      if (!register && !match && !sign && !linkRoute && !trade && !tradeStatus && !browserScript) return false;
      sweep();
      if (browserScript && req.method === 'GET') {
        res.writeHead(200, { 'content-type':'text/javascript; charset=utf-8', 'cache-control':'public, max-age=86400', 'x-content-type-options':'nosniff' });
        res.end(WEB3_BROWSER_SCRIPT);
        return true;
      }
      if (register && req.method === 'POST') {
        if (req.headers.origin !== appOrigin) { reply(res, 403, { error: 'Open the wallet request from the app origin.' }); return true; }
        if (flows.size >= MAX_FLOWS) { reply(res, 429, { error: 'Too many active wallet requests.' }); return true; }
        const input = await readBody(req);
        if (!FLOW_ID.test(input.id || '') || !POLL_TOKEN.test(input.pollToken || '')) { reply(res, 400, { error: 'Invalid wallet request.' }); return true; }
        if (flows.has(input.id)) { reply(res, 409, { error: 'Wallet request already exists.' }); return true; }
        const signRequest = input.signRequest;
        if (signRequest !== undefined && (!signRequest || typeof signRequest.message !== 'string' || signRequest.message.length < 1 || signRequest.message.length > 1024 || typeof signRequest.publicKey !== 'string' || !B58.test(signRequest.publicKey) || bs58.decode(signRequest.publicKey).length !== 32)) { reply(res, 400, { error: 'Invalid signing request.' }); return true; }
        const transactionRequest = input.transactionRequest;
        if (signRequest && transactionRequest) { reply(res, 400, { error:'Choose one wallet request.' }); return true; }
        if (transactionRequest !== undefined) {
          try {
            if (!transactionRequest || typeof transactionRequest.publicKey !== 'string' || !B58.test(transactionRequest.publicKey) || bs58.decode(transactionRequest.publicKey).length !== 32 || typeof transactionRequest.transaction !== 'string' || transactionRequest.transaction.length > 4000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(transactionRequest.transaction)) throw new Error('Invalid transaction request.');
            const unsigned = Transaction.from(Buffer.from(transactionRequest.transaction, 'base64'));
            if (unsigned.feePayer?.toBase58() !== transactionRequest.publicKey) throw new Error('Invalid fee payer.');
            const message = unsigned.serializeMessage();
            const coSignatures = unsigned.signatures.filter(entry => entry.publicKey.toBase58() !== transactionRequest.publicKey && entry.signature);
            if (coSignatures.some(entry => !nacl.sign.detached.verify(message, entry.signature, entry.publicKey.toBytes()))) throw new Error('Invalid transaction co-signature.');
            if (coSignatures.length && (!Number.isSafeInteger(transactionRequest.lastValidBlockHeight) || transactionRequest.lastValidBlockHeight <= 0)) throw new Error('Missing signed transaction expiry.');
            if (transactionRequest.summary !== undefined && !validTradeSummary(transactionRequest.summary)) throw new Error('Invalid trade review.');
          } catch { reply(res, 400, { error:'Invalid transaction request.' }); return true; }
        }
        flows.set(input.id, { pollToken: input.pollToken, expiresAt: now() + FLOW_TTL_MS, result: null, signRequest: signRequest || null, transactionRequest:transactionRequest || null, preSigned: Boolean(transactionRequest && Transaction.from(Buffer.from(transactionRequest.transaction, 'base64')).signatures.some(entry => entry.publicKey.toBase58() !== transactionRequest.publicKey && entry.signature)), submittedSignature:null, outcome:null, nextStatusCheckAt:0 });
        reply(res, 201, { callbackUrl: `${appOrigin}/api/mobile-wallet/callback/${input.id}`, expiresInSeconds: FLOW_TTL_MS / 1000 });
        return true;
      }
      if (linkRoute?.[1] === 'link' && req.method === 'POST') {
        const flow = flows.get(linkRoute[2]);
        const provided = String(req.headers['x-mobile-wallet-token'] || '');
        if (req.headers.origin !== appOrigin || !flow || flow.result || !POLL_TOKEN.test(provided) || !timingSafeEqual(Buffer.from(provided), Buffer.from(flow.pollToken))) { reply(res, 404, { error:'Wallet request unavailable.' }); return true; }
        const input = await readBody(req);
        let target;
        try { target = new URL(input.link); } catch { reply(res, 400, { error:'Invalid Phantom link.' }); return true; }
        if (input.link.length > 10000 || target.origin !== 'https://phantom.app' || target.pathname !== '/ul/v1/signTransaction' || target.searchParams.get('redirect_link') !== `${appOrigin}/api/mobile-wallet/callback/${linkRoute[2]}` || !target.searchParams.has('payload') || !target.searchParams.has('nonce') || !target.searchParams.has('dapp_encryption_public_key')) { reply(res, 400, { error:'Invalid Phantom transaction link.' }); return true; }
        flow.link = target.toString();
        reply(res, 200, { openUrl:`${appOrigin}/api/mobile-wallet/open/${linkRoute[2]}` });
        return true;
      }
      if (linkRoute?.[1] === 'open' && req.method === 'GET') {
        const flow = flows.get(linkRoute[2]);
        if (!flow?.link || flow.result) { reply(res, 404, { error:'Wallet request unavailable.' }); return true; }
        res.writeHead(302, { location:flow.link, 'cache-control':'no-store', 'referrer-policy':'no-referrer', 'x-content-type-options':'nosniff' });
        res.end();
        return true;
      }
      if (sign?.[1] === 'sign-request' && req.method === 'GET') {
        const flow = flows.get(sign[2]);
        if (!flow?.signRequest || flow.result) { reply(res, 404, { error: 'Signing request unavailable.' }); return true; }
        reply(res, 200, flow.signRequest);
        return true;
      }
      if (sign?.[1] === 'sign' && req.method === 'GET') {
        const flow = flows.get(sign[2]);
        if (!flow?.signRequest || flow.result) { reply(res, 404, { error: 'Signing request unavailable.' }); return true; }
        const { html, nonce } = signerPage(sign[2]);
        res.writeHead(200, { 'content-type':'text/html; charset=utf-8', 'cache-control':'no-store', 'referrer-policy':'no-referrer', 'x-content-type-options':'nosniff', 'content-security-policy':`default-src 'none'; connect-src 'self'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'` });
        res.end(html);
        return true;
      }
      if (sign?.[1] === 'sign' && req.method === 'POST') {
        const flow = flows.get(sign[2]);
        if (req.headers.origin !== appOrigin) { reply(res, 403, { error:'Open the signer on funded.vip.' }); return true; }
        if (!flow?.signRequest || flow.result) { reply(res, 404, { error:'Signing request unavailable.' }); return true; }
        const input = await readBody(req);
        const encoded = String(input.signature || '');
        const signature = SIGNATURE_B64.test(encoded) ? Buffer.from(encoded, 'base64') : null;
        const message = new TextEncoder().encode(flow.signRequest.message);
        const publicKey = bs58.decode(flow.signRequest.publicKey);
        if (!signature || signature.length !== nacl.sign.signatureLength || !nacl.sign.detached.verify(message, signature, publicKey)) { reply(res, 400, { error:'Signature does not match the selected wallet and message.' }); return true; }
        flow.result = { signature:bs58.encode(signature), publicKey:flow.signRequest.publicKey, source:'phantom-injected' };
        reply(res, 200, { status:'complete' });
        return true;
      }
      if (tradeStatus && req.method === 'POST') {
        const flow = flows.get(tradeStatus[1]);
        const provided = String(req.headers['x-mobile-wallet-token'] || '');
        if (req.headers.origin !== appOrigin || !flow?.transactionRequest || !flow.result?.transaction || !POLL_TOKEN.test(provided) || !timingSafeEqual(Buffer.from(provided), Buffer.from(flow.pollToken))) { reply(res, 404, { error:'Trade status unavailable.' }); return true; }
        const input = await readBody(req);
        const signature = String(input.signature || '');
        let expectedSignature;
        try {
          const signed = Transaction.from(bs58.decode(flow.result.transaction));
          expectedSignature = bs58.encode(signed.signatures.find(entry => entry.publicKey.toBase58() === flow.transactionRequest.publicKey).signature);
        } catch { reply(res, 400, { error:'Signed transaction is unavailable.' }); return true; }
        if (signature !== expectedSignature) { reply(res, 400, { error:'Signature does not match the signed trade.' }); return true; }
        flow.submittedSignature = signature;
        flow.expiresAt = now() + TRADE_RESULT_TTL_MS;
        reply(res, 200, { status:'submitted', signature });
        return true;
      }
      if (tradeStatus && req.method === 'GET') {
        const flow = flows.get(tradeStatus[1]);
        if (!flow?.transactionRequest) { reply(res, 404, { error:'Trade status unavailable.' }); return true; }
        if (flow.submittedSignature && !flow.outcome && typeof getFinalizedTransaction === 'function' && now() >= flow.nextStatusCheckAt) {
          flow.nextStatusCheckAt = now() + 3000;
          try {
            const finalized = await getFinalizedTransaction(flow.submittedSignature);
            if (finalized) flow.outcome = finalizedTradeOutcome(finalized, flow.transactionRequest.publicKey, flow.transactionRequest.summary?.mint || null);
          } catch { /* Keep the submitted state while the Devnet RPC is unavailable. */ }
        }
        reply(res, 200, { status:flow.outcome?.state || (flow.submittedSignature ? 'submitted' : flow.result ? 'signed' : 'review'), ...(flow.submittedSignature ? { signature:flow.submittedSignature } : {}), ...(flow.outcome || {}) });
        return true;
      }
      if (trade?.[1] === 'trade-request' && req.method === 'GET') {
        const flow = flows.get(trade[2]);
        if (!flow?.transactionRequest || flow.result) { reply(res, 404, { error:'Trade request unavailable.' }); return true; }
        reply(res, 200, flow.transactionRequest);
        return true;
      }
      if (trade?.[1] === 'trade-refresh' && req.method === 'POST') {
        if (req.headers.origin !== appOrigin) { reply(res, 403, { error:'Open the signer on funded.vip.' }); return true; }
        const flow = flows.get(trade[2]);
        if (!flow?.transactionRequest || flow.result) { reply(res, 404, { error:'Trade request unavailable.' }); return true; }
        if (flow.preSigned) {
          // Changing the blockhash would invalidate the mint's existing signature.
          flow.lastValidBlockHeight = flow.transactionRequest.lastValidBlockHeight;
          reply(res, 200, flow.transactionRequest);
          return true;
        }
        if (typeof getLatestBlockhash !== 'function') { reply(res, 503, { error:'Devnet blockhash refresh is unavailable.' }); return true; }
        try {
          const latest = await getLatestBlockhash();
          if (!B58.test(latest?.blockhash || '') || bs58.decode(latest.blockhash).length !== 32 || !Number.isSafeInteger(latest.lastValidBlockHeight) || latest.lastValidBlockHeight <= 0) throw new Error('Invalid Devnet blockhash.');
          const unsigned = Transaction.from(Buffer.from(flow.transactionRequest.transaction, 'base64'));
          unsigned.recentBlockhash = latest.blockhash;
          flow.transactionRequest = { ...flow.transactionRequest, transaction:Buffer.from(unsigned.serialize({ requireAllSignatures:false, verifySignatures:false })).toString('base64') };
          flow.lastValidBlockHeight = latest.lastValidBlockHeight;
          reply(res, 200, flow.transactionRequest);
        } catch { reply(res, 503, { error:'Could not refresh the Devnet transaction. Try again.' }); }
        return true;
      }
      if (trade?.[1] === 'trade' && req.method === 'GET') {
        const flow = flows.get(trade[2]);
        if (!flow?.transactionRequest || flow.result) { reply(res, 404, { error:'Trade request unavailable.' }); return true; }
        const { html, nonce } = renderTradeSignerPage(trade[2]);
        res.writeHead(200, { 'content-type':'text/html; charset=utf-8', 'cache-control':'no-store', 'referrer-policy':'no-referrer', 'x-content-type-options':'nosniff', 'content-security-policy':`default-src 'none'; connect-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'unsafe-inline'` });
        res.end(html);
        return true;
      }
      if (trade?.[1] === 'trade' && req.method === 'POST') {
        const flow = flows.get(trade[2]);
        if (req.headers.origin !== appOrigin) { reply(res, 403, { error:'Open the signer on funded.vip.' }); return true; }
        if (!flow?.transactionRequest || flow.result) { reply(res, 404, { error:'Trade request unavailable.' }); return true; }
        const input = await readBody(req);
        const encoded = String(input.transaction || '');
        let instructionDifference = null;
        try {
          if (encoded.length > 4000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw tradeSignatureFailure('invalid-encoding');
          const raw = Buffer.from(encoded, 'base64');
          const signed = Transaction.from(raw);
          const unsigned = Transaction.from(Buffer.from(flow.transactionRequest.transaction, 'base64'));
          const inspection = inspectPhantomTradeTransaction(unsigned, signed);
          if (!inspection.ok) {
            instructionDifference = tradeInstructionDifference(unsigned, signed);
            throw tradeSignatureFailure(inspection.code);
          }
          const message = signed.serializeMessage();
          const signature = signed.signatures.find(entry => entry.publicKey.toBase58() === flow.transactionRequest.publicKey)?.signature;
          if (!signature) throw tradeSignatureFailure('wallet-signature-missing');
          if (!nacl.sign.detached.verify(message, signature, bs58.decode(flow.transactionRequest.publicKey))) throw tradeSignatureFailure('wallet-signature-invalid');
          if (!signed.verifySignatures()) throw tradeSignatureFailure('other-signature-invalid');
          flow.result = { transaction:bs58.encode(raw), publicKey:flow.transactionRequest.publicKey, blockhash:signed.recentBlockhash, lastValidBlockHeight:flow.lastValidBlockHeight, source:'phantom-injected' };
        } catch (error) {
          const code = Object.hasOwn(TRADE_SIGNATURE_ERRORS, error?.code) ? error.code : 'invalid-encoding';
          console.warn(JSON.stringify({ event:'mobile-trade-signature-rejected', code, ...(instructionDifference ? { instructionDifference } : {}) }));
          reply(res, 400, { code, error:TRADE_SIGNATURE_ERRORS[code] });
          return true;
        }
        reply(res, 200, { status:'complete' });
        return true;
      }
      if (match?.[1] === 'relay' && req.method === 'GET') {
        const flow = flows.get(match[2]);
        const provided = String(req.headers['x-mobile-wallet-token'] || '');
        if (!flow || !POLL_TOKEN.test(provided) || !timingSafeEqual(Buffer.from(provided), Buffer.from(flow.pollToken))) { reply(res, 404, { error: 'Wallet request unavailable.' }); return true; }
        reply(res, 200, flow.result ? { status: 'complete', result: flow.result } : { status: 'pending' });
        return true;
      }
      if (match?.[1] === 'callback' && req.method === 'GET') {
        const flow = flows.get(match[2]);
        if (flow && !url.searchParams.has('data') && !url.searchParams.has('errorCode')) {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'" });
          res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>funded.vip · Phantom approval</title><meta property="og:title" content="funded.vip"><link rel="icon" href="${appOrigin}/favicon.svg"><body style="font:16px system-ui;padding:2rem;background:#15121f;color:#fff"><h1>funded.vip</h1><p>Approve this wallet request in Phantom, then return to the desktop tab.</p></body>`);
          return true;
        }
        let result = null;
        if (url.searchParams.has('errorCode')) {
          result = { errorCode: String(url.searchParams.get('errorCode') || '').slice(0, 80), errorMessage: String(url.searchParams.get('errorMessage') || '').slice(0, 200) };
        } else {
          const data = url.searchParams.get('data') || '';
          const nonce = url.searchParams.get('nonce') || '';
          const phantomPublicKey = url.searchParams.get('phantom_encryption_public_key') || '';
          if (data.length <= 6000 && B58.test(data) && nonce.length <= 64 && B58.test(nonce) && (!phantomPublicKey || phantomPublicKey.length <= 64 && B58.test(phantomPublicKey))) result = { data, nonce, phantom_encryption_public_key: phantomPublicKey };
        }
        const accepted = Boolean(flow && !flow.result && result);
        if (accepted) flow.result = result;
        const message = accepted ? 'Return to the funded.vip desktop tab. You can close this page.' : 'This wallet request expired or could not be completed. Start again on the desktop.';
        res.writeHead(accepted ? 200 : 400, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" });
        res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Phantom approval</title><body style="font:16px system-ui;padding:2rem;background:#15121f;color:#fff"><h1>Phantom approval received</h1><p>${message}</p></body>`);
        return true;
      }
      reply(res, 405, { error: 'Method not allowed.' });
      return true;
    },
  };
}
