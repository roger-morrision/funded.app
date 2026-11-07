import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { allowedAuthOrigin } from '../x-auth.mjs';
import { PublicKey } from '@solana/web3.js';
import { validateInput } from '../http-policy.mjs';
import { validateTokenChatText, tokenChatPostStatement, tokenChatDeleteStatement } from '../../token-chat.js';
import { randomBytes, createHash } from 'node:crypto';
import { recordCallout } from './callouts.mjs';

const tokenChatSignatureWindowMs = 5 * 60 * 1000;

function tokenChatPublicMessage(message) {
  return {
    id: message.id,
    mint: message.mint,
    author: message.author,
    text: message.text,
    createdAt: message.createdAt,
    ...(message.callout ? { callout: { marketCapSol: message.callout.marketCapSol, holdingPercent: message.callout.holdingPercent ?? null } } : {}),
  };
}
function validTokenChatEnvelope(input) {
  const nonce = String(input?.nonce || '').trim();
  const issuedAt = String(input?.issuedAt || '').trim();
  const issued = Date.parse(issuedAt);
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(nonce)) throw Object.assign(new Error('A valid one-time message nonce is required.'), { statusCode: 400 });
  if (!Number.isFinite(issued) || issued < Date.now() - tokenChatSignatureWindowMs || issued > Date.now() + 60_000) throw Object.assign(new Error('The wallet signature request has expired. Try again.'), { statusCode: 400 });
  return { nonce, issuedAt: new Date(issued).toISOString() };
}
function verifyTokenChatSignature(statement, signatureValue, publicKey) {
  try {
    if (typeof signatureValue !== 'string' || signatureValue.length > 100) return false;
    const signature = bs58.decode(String(signatureValue || ''));
    return signature.length === nacl.sign.signatureLength && nacl.sign.detached.verify(new TextEncoder().encode(statement), signature, publicKey.toBytes());
  } catch { return false; }
}
// Called after the shared request policy, rate limit, and authorization checks.
// Return true only after sending a response; false lets the router continue.
export function createTokenChatRoutes({
  body, walletKey, store, clientKey, tokenChatSessions, referralSession, requireAuthorized,
  respond, readMarketCaps = null, readHolderShare = null, readCalloutFeed = null, readTradeMetrics = null,
}) {

  const json = (...args) => { respond(...args); return true; };
  let feedCache = null;
  return async function handleTokenChatRoutes(req, res, url, requestId) {
    if (req.method === 'GET' && url.pathname === '/api/token-chat/feed') {
      if (feedCache && Date.now()-feedCache.at < 3_000) return json(res,200,await feedCache.value);
      const value = (async () => {
      const rows = (await store.readRecentCoinChats(50)).filter(row => !['hidden','deleted'].includes(row.status)).slice(0,50);
      const calls = rows.some(row => row.callout) && readCalloutFeed ? await readCalloutFeed().catch(() => null) : null;
      const byId = new Map((calls?.callouts || []).map(row => [row.id,row]));
      const metrics = readTradeMetrics ? await readTradeMetrics(rows).catch(()=>({})) : {};
      const messages = rows.map(row => {
        const message = tokenChatPublicMessage(row), call = byId.get(row.id);
        if (message.callout) message.callout = {...message.callout, purchasedSol:metrics[row.id]?.purchasedSol??null, pnlSol:metrics[row.id]?.pnlSol??null,
          tradeMetrics:metrics[row.id]||null,
          marketChangePercent:Number.isFinite(call?.multiple) ? (call.multiple - 1) * 100 : null};
        return message;
      });
      return {messages,serverTime:new Date().toISOString()};
      })();
      feedCache={at:Date.now(),value};
      try { return json(res,200,await value); }
      catch(error) { if(feedCache?.value===value)feedCache=null;throw error; }
    }
    const tokenChatSessionAction = req.method === 'POST' ? url.pathname.match(/^\/api\/token-chat\/session\/(prepare|verify|revoke)$/)?.[1] : null;
    if (tokenChatSessionAction) {
      if (!allowedAuthOrigin(req, process.env.CORS_ORIGIN)) return json(res, 403, { error: 'Chat session origin is not allowed.' });
      const origin = String(req.headers.origin);
      if (tokenChatSessionAction === 'prepare') {
        const input = await body(req);
        let address;
        try { address = walletKey(input.address); }
        catch { return json(res, 400, { error: 'Connect a valid Solana wallet before posting.' }); }
        const minute = Math.floor(Date.now() / 60_000) * 60_000;
        if (!await store.chargeRpcRate(`chat-auth:${clientKey(req)}:${address}`, 1, 8, minute)) return json(res, 429, { error: 'Too many chat verification requests. Wait a minute.' });
        return json(res, 200, await tokenChatSessions.prepare(address, origin));
      }
      if (tokenChatSessionAction === 'verify') {
        const input = await body(req);
        const result = await tokenChatSessions.verify(String(input.challengeId || ''), input.signature, origin);
        return result ? json(res, 200, result) : json(res, 401, { error: 'Wallet verification failed or expired. Try again.' });
      }
      await tokenChatSessions.revoke(req.headers['x-token-chat-session']);
      return json(res, 200, { revoked: true });
    }
    const tokenChatMatch = url.pathname.match(/^\/api\/tokens\/([^/]+)\/chat(?:\/(delete|report))?$/);
    if (tokenChatMatch && (req.method === 'GET' || req.method === 'POST')) {
      let mint;
      try { mint = new PublicKey(decodeURIComponent(tokenChatMatch[1])).toBase58(); }
      catch { return json(res, 400, { error: 'A valid Solana mint is required.' }); }
      const action = tokenChatMatch[2] || 'post';
      if (req.method === 'GET') {
        if (action !== 'post') { res.setHeader('allow', 'POST'); return json(res, 405, { error: 'Method not allowed.' }); }
        const messages = (await store.readCoinChat(mint, 100)).filter(message => message.status !== 'hidden' && message.status !== 'deleted').slice(-50).map(tokenChatPublicMessage);
        return json(res, 200, { mint, messages, enabled: true, authentication: 'solana-wallet-session' });
      }
      const sessionToken = req.headers['x-token-chat-session'];
      if (sessionToken && !allowedAuthOrigin(req, process.env.CORS_ORIGIN)) return json(res, 403, { error: 'Chat session origin is not allowed.' });
      const sessionAddress = sessionToken === 'wallet' ? (await referralSession(req))?.wallet
        : sessionToken ? await tokenChatSessions.address(sessionToken, String(req.headers.origin)) : null;
      if (sessionToken && !sessionAddress) return json(res, 401, { error: 'Chat verification expired. Verify your wallet again.' });
      const input = await body(req);
      if (action === 'report') {
        if (!sessionAddress) return json(res, 401, { error: 'Verify your wallet before reporting.' });
        const messageId = String(input.messageId || '');
        const reason = String(input.reason || 'spam-or-scam');
        if (!/^chat_[a-f0-9]{24}$/.test(messageId) || !['spam-or-scam', 'harassment', 'impersonation'].includes(reason)) return json(res, 400, { error: 'Select a valid message and report reason.' });
        if (!await store.chargeRpcRate(`chat-report:${sessionAddress}`, 1, 5, Math.floor(Date.now()/60000)*60000)) return json(res, 429, { error: 'Reporting limit reached. Please wait a minute.' });
        const outcome = await store.updateCoinChat(mint, messages => {
          const message = messages.find(row => row.id === messageId && row.status !== 'deleted');
          if (!message) return { status: 404, error: 'Discussion message not found.' };
          if (message.author === sessionAddress) return { status: 400, error: 'You can delete your own message.' };
          message.reports ||= {};
          if (!message.reports[sessionAddress] && Object.keys(message.reports).length >= 100) return { status: 200, reported: true };
          message.reports[sessionAddress] ||= { reason, createdAt: new Date().toISOString() };
          return { status: 200, reported: true };
        });
        return json(res, outcome.status, outcome.error ? { error: outcome.error } : { reported: true });
      }
      const envelope = sessionAddress ? null : validTokenChatEnvelope(input);
      if (action === 'post') {
        let author;
        try { author = walletKey(input.author); }
        catch { return json(res, 400, { error: 'Connect a valid Solana wallet before posting.' }); }
        const text = validateInput(() => validateTokenChatText(input.text));
        if (sessionAddress ? sessionAddress !== author : !verifyTokenChatSignature(tokenChatPostStatement({ mint, author, text, ...envelope }), input.signature, new PublicKey(author))) return json(res, 401, { error: 'Wallet verification is invalid for this account.' });
        const minute = Math.floor(Date.now() / 60_000) * 60_000;
        if (!await store.chargeRpcRate(`chat-wallet:${author}`, 1, 5, minute)) return json(res, 429, { error: 'Posting limit reached. Wait a minute before posting again.' });
        let callout = null, calloutStatus = 'holdings-unavailable';
        // Authenticated posts become calls only from a current server-read holding.
        // Unknown/zero holdings, unavailable quotes and call limits still allow chat.
        const holding = readHolderShare ? await readHolderShare(author, mint).catch(() => null) : null;
        if(Number.isFinite(holding)&&holding===0)calloutStatus='not-holder';
        if (Number.isFinite(holding) && holding > 0 && readMarketCaps && store.updateCallouts) {
          const checked = await recordCallout({ store, readMarketCaps, readHolderShare: async () => holding, mint, author });
          calloutStatus=checked.error?(checked.status===429?'repeat-call':'market-unavailable'):'rate-limited';
          if (!checked.error && await store.chargeRpcRate(`callout-wallet:${author}`, 1, 10, Math.floor(Date.now() / 3_600_000) * 3_600_000)) {
            callout = { marketCapSol: checked.cap.marketCapSol, holdingPercent: checked.holdingPercent, observedAt: checked.cap.observedAt };
            calloutStatus='recorded';
          }
        }
        const messageId = sessionAddress ? `chat_${randomBytes(12).toString('hex')}` : `chat_${createHash('sha256').update(String(input.signature)).digest('hex').slice(0, 24)}`;
        const createdAt = new Date().toISOString();
        const outcome = await store.updateCoinChat(mint, messages => {
          if (messages.some(message => message.id === messageId)) return { status: 409, error: 'This signed message was already posted.' };
          const recentByAuthor = [...messages].reverse().find(message => message.author === author);
          if (recentByAuthor && Date.now() - Date.parse(recentByAuthor.createdAt) < 10_000) return { status: 429, error: 'Wait a few seconds before posting again.' };
          const duplicate = messages.some(message => message.author === author && message.text === text && Date.now() - Date.parse(message.createdAt) < 10 * 60_000);
          if (duplicate) return { status: 409, error: 'This message was already posted recently.' };
          const message = { id: messageId, mint, author, text, createdAt, status: 'visible', reports: {}, ...(callout ? { callout } : {}), ...(sessionAddress ? { auth: 'wallet-session' } : { signature: String(input.signature) }) };
          messages.push(message);
          return { status: 201, message: tokenChatPublicMessage(message) };
        });
        feedCache=null;
        if (callout && !outcome.error) await store.updateCallouts(list => { list.push({ id: messageId, mint, author, text, createdAt, marketCapSol: callout.marketCapSol, peakMarketCapSol: callout.marketCapSol, holdingPercent: callout.holdingPercent }); });
        return json(res, outcome.status, outcome.error ? { error: outcome.error } : { message: outcome.message, calloutStatus });
      }
      const messageId = String(input.messageId || '').trim();
      if (!/^chat_[a-f0-9]{24}$/.test(messageId)) return json(res, 400, { error: 'A valid discussion message is required.' });
      let author;
      try { author = walletKey(input.author); }
      catch { return json(res, 400, { error: 'Connect the author wallet before deleting.' }); }
      if (sessionAddress ? sessionAddress !== author : !verifyTokenChatSignature(tokenChatDeleteStatement({ mint, messageId, author, ...envelope }), input.signature, new PublicKey(author))) return json(res, 401, { error: 'Wallet verification is invalid for this account.' });
      const outcome = await store.updateCoinChat(mint, messages => {
        const message = messages.find(item => item.id === messageId);
        if (!message) return { status: 404, error: 'Discussion message not found.' };
        if (message.author !== author) return { status: 403, error: 'Only the author can delete this message.' };
        message.status = 'deleted'; message.deletedAt = new Date().toISOString(); message.text = '';
        return { status: 200, deleted: true, messageId };
      });
      if (outcome.deleted) { feedCache=null; await store.updateCallouts?.(list => { const index = list.findIndex(entry => entry.id === messageId); if (index >= 0) list.splice(index, 1); }); }
      return json(res, outcome.status, outcome.error ? { error: outcome.error } : outcome);
    }
    if (url.pathname === '/api/ops/token-chat' && req.method === 'GET') {
      if (!requireAuthorized(req, res)) return true;
      const state = await store.read();
      const messages = Object.entries(state.coinChats || {}).flatMap(([mint, rows]) => (rows || []).map(message => ({ ...tokenChatPublicMessage(message), mint, status: message.status || 'visible', reports: Object.entries(message.reports || {}).map(([reporter, report]) => ({ reporter, ...report })), moderationReason: message.moderationReason || null, moderatedAt: message.moderatedAt || null })));
      return json(res, 200, { messages: messages.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 500) });
    }
    if (url.pathname === '/api/ops/token-chat/moderate' && req.method === 'POST') {
      if (!requireAuthorized(req, res)) return true;
      const input = await body(req);
      let mint;
      try { mint = walletKey(input.mint); }
      catch { return json(res, 400, { error: 'A valid Solana mint is required.' }); }
      const messageId = String(input.messageId || '').trim();
      const action = String(input.action || '').trim().toLowerCase();
      const reason = String(input.reason || '').trim().slice(0, 160);
      if (!['hide', 'restore'].includes(action)) return json(res, 400, { error: 'Moderation action must be hide or restore.' });
      if (action === 'hide' && !reason) return json(res, 400, { error: 'A moderation reason is required when hiding a message.' });
      const outcome = await store.updateCoinChat(mint, messages => {
        const message = messages.find(item => item.id === messageId);
        if (!message || message.status === 'deleted') return null;
        message.status = action === 'hide' ? 'hidden' : 'visible';
        message.moderatedAt = new Date().toISOString();
        message.moderationReason = action === 'hide' ? reason : null;
        message.moderatedBy = 'operations';
        return { ...tokenChatPublicMessage(message), status: message.status, moderationReason: message.moderationReason, moderatedAt: message.moderatedAt };
      });
      feedCache=null;
      if (outcome) await store.updateCallouts?.(list => { const entry = list.find(row => row.id === messageId); if (entry) entry.hidden = action === 'hide'; });
      return outcome ? json(res, 200, outcome) : json(res, 404, { error: 'Discussion message not found.' });
    }
    return false;
  };
}
