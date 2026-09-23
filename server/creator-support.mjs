import { randomBytes } from 'node:crypto';
import { validXId, validMint, normalizeCreatorHandle, creatorAuthorization, creatorMilestone } from '../creator-support-model.js';
import { creatorCardPng } from './share-card.mjs';
import { createReadCache } from './read-cache.mjs';
import { eligibleSupportLaunches } from './creator-directory.mjs';
import { allowedAuthOrigin } from './x-auth.mjs';
import { decodeReceiptCursor, receiptFingerprint } from './receipt-history.mjs';
import { followingWindow } from './following-updates.mjs';
export { eligibleSupportLaunches } from './creator-directory.mjs';
const financialInputs=state=>Object.fromEntries(['launches','obligations','claims','collections','payouts'].map(bucket=>[bucket,state[bucket]||{}]));
const sameFinancialInputs=(before,after)=>receiptFingerprint('creator-inputs',financialInputs(before))===receiptFingerprint('creator-inputs',financialInputs(after));

// Public totals join chain-verified receipts to the original immutable entitlement.
// A ledger's paid flag alone is never accepted, and duplicate signatures count once.
export function buildCreatorSupport(state, id, evidence, cluster) {
  if (!validXId(id)) return null;
  const profile = state.creatorProfiles?.[id];
  if (profile?.optedOut) return null;
  const launches = eligibleSupportLaunches(state, cluster).filter(launch => String(launch.xUserId) === id).sort((a,b)=>a.mint<b.mint?-1:a.mint>b.mint?1:0);
  if (!launches.length && !(profile?.listed && profile.identityVerified)) return null;
  const rawHandle = profile?.handle || launches[0]?.feeDistribution?.creatorDirected?.recipients?.xAccount;
  let handle;
  try { handle = normalizeCreatorHandle(rawHandle); } catch { return null; }
  const receipts = [];
  const seen = new Set();
  for (const proof of evidence?.cluster === cluster ? evidence.verifiedPayouts || [] : []) {
    if (seen.has(proof.signature)) continue;
    const payout = Object.values(state.payouts || {}).find(row => row.signature === proof.signature && row.claimId === proof.claimId);
    const obligation = state.obligations?.[payout?.obligationId];
    const claim = state.claims?.[payout?.claimId];
    const launch = launches.find(row => row.mint === obligation?.mint);
    const collection = state.collections?.[obligation?.claimSignature];
    const collectionProof = evidence.verifiedCollections?.find(row => row.signature === obligation?.claimSignature && row.mint === launch?.mint);
    if (!launch || !payout || !claim || !collectionProof || obligation?.source !== 'verified-per-mint-router-collection'
      || String(obligation.xUserId) !== id || claim.xUserId !== id || claim.obligationId !== obligation.id
      || claim.publicKey !== proof.to || payout.to !== proof.to || payout.from !== launch.pumpFeeRoute.router
      || payout.mint !== launch.mint || payout.cluster !== cluster || payout.source !== 'mint-router-settle-mint'
      || proof.source !== 'mint-router-settle-mint' || collection?.router !== launch.pumpFeeRoute.router
      || !Number.isSafeInteger(proof.amountLamports) || proof.amountLamports <= 0) continue;
    const bps = Math.round(Number(launch.feeDistribution.creatorDirected.shares.solClaimPercent) * 100);
    if (!Number.isSafeInteger(collectionProof.collectedLamports) || collectionProof.collectedLamports <= 0 || bps <= 0 || bps > 8000) continue;
    const expected = BigInt(collectionProof.collectedLamports) * BigInt(bps) / 10000n;
    if (String(obligation.amountLamports) !== expected.toString() || BigInt(proof.amountLamports) !== expected) continue;
    seen.add(proof.signature);
    receipts.push({ signature: proof.signature, mint: launch.mint, amountLamports: expected.toString(), paidAt: payout.paidAt, slot: proof.slot });
  }
  const paidLamports = receipts.reduce((sum, receipt) => sum + BigInt(receipt.amountLamports), 0n).toString();
  return { id, handle, name: profile?.name || handle, cluster,
    identityVerified: profile?.identityVerified === true,
    authorization: 'Authorization is per coin, not implied by receiving fees.',
    coins: launches.map(launch => ({ mint: launch.mint, name: launch.name || 'Unnamed coin', symbol: launch.symbol || '',
      creatorWallet: launch.creatorWallet, sharePercent: launch.feeDistribution.creatorDirected.shares.solClaimPercent,
      authorization: creatorAuthorization(profile, launch.mint) })),
    updates: profile?.identityVerified ? (profile.updates || []).slice(-20).reverse() : [],
    receipts, paidLamports,
    evidenceStatus: evidence?.status || 'unavailable',
    coverage: 'Bounded recent verified receipts; not an all-time earnings total.',
    milestone: creatorMilestone(paidLamports) };
}

export function updateCreatorProfile(state, user, input, now = new Date().toISOString()) {
  const id = String(user?.id || '');
  if (!validXId(id) || !user.username) throw new Error('Verified X identity is required.');
  if (typeof input.listed !== 'boolean' || typeof input.optedOut !== 'boolean' || !Array.isArray(input.authorizedMints)
    || input.authorizedMints.length > 100) throw new Error('Review listing, exclusion and per-coin consent choices.');
  const eligible = new Set(eligibleSupportLaunches(state, 'devnet').filter(row => row.xUserId === id).map(row => row.mint));
  if (input.authorizedMints.some(mint => !eligible.has(mint))) throw new Error('Only coins with a verified policy naming your X user ID can be authorized.');
  state.creatorProfiles ||= {};
  const prior = state.creatorProfiles[id] || {};
  return state.creatorProfiles[id] = { ...prior, id, handle: normalizeCreatorHandle(user.username), name: String(user.name || user.username).slice(0,80),
    identityVerified: true, listed: input.listed && !input.optedOut, optedOut: input.optedOut,
    authorizedMints: input.optedOut ? [] : [...new Set(input.authorizedMints)], updatedAt: now };
}

export function createCreatorSupportHandler({ store, cluster, getSession, readEvidence, readFinalizedEvidence, capabilities }) {
  const cards=new Map();
  const capabilityCache=createReadCache({ttlMs:15000,maxEntries:1});
  const respond = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); return true; };
  return async (req, res, url) => {
    if (!url.pathname.startsWith('/api/creators') && !url.pathname.startsWith('/api/creator-support') && url.pathname !== '/api/capabilities') return false;
    if(req.method==='GET'&&!await store.chargeRpcRate(`creator-read:${req.socket?.remoteAddress||'local'}`,1,120,Math.floor(Date.now()/60000)*60000))return respond(res,429,{error:'Creator read limit reached. Please wait before refreshing.'});
    if (req.method === 'GET' && url.pathname === '/api/capabilities') return respond(res, 200, await capabilityCache('capabilities',capabilities));
    const session = await getSession(req);
    if(req.method==='GET'&&url.pathname==='/api/creator-support/following-updates') {
      const ids=String(url.searchParams.get('ids')||'').split(',').filter(Boolean),after=String(url.searchParams.get('after')||'');
      try {followingWindow(ids,after);}catch(error){return respond(res,400,{error:error.message});}
      return respond(res,200,{...await store.readFollowingUpdates(cluster,ids,after),cluster});
    }
    if (url.pathname === '/api/creator-support/me' && req.method === 'GET') {
      if (!session?.user?.id) return respond(res, 401, { error: 'Sign in with X to manage your creator page.' });
      session.creatorCsrf ||= randomBytes(24).toString('hex');
      const state = await store.readCreatorState(String(session.user.id),cluster,{financial:false});
      return respond(res, 200, { csrf: session.creatorCsrf, user: { id: session.user.id, username: session.user.username },
        profile: state.creatorProfiles?.[session.user.id] || null,
        coins: eligibleSupportLaunches(state, cluster).filter(row => row.xUserId === session.user.id).map(row => ({ mint: row.mint, name: row.name })) });
    }
    if (req.method === 'POST' && ['/api/creator-support/profile', '/api/creator-support/updates', '/api/creator-support/preferences'].includes(url.pathname)) {
      if (cluster !== 'devnet') return respond(res, 503, { error: 'Creator support is Devnet-only pending production review.' });
      if (!session?.user?.id) return respond(res, 401, { error: 'Verified X sign-in is required.' });
      if (!allowedAuthOrigin(req, process.env.CORS_ORIGIN) || !session.creatorCsrf || req.headers['x-creator-csrf'] !== session.creatorCsrf) return respond(res, 403, { error: 'Reload your creator settings before saving.' });
      if (!await store.chargeRpcRate(`creator-write:${session.user.id}`, 1, 10, Math.floor(Date.now()/60000)*60000)) return respond(res, 429, { error: 'Please wait before updating again.' });
      let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 16000) return respond(res, 413, { error: 'Creator update is too large.' }); }
      let input; try { input = JSON.parse(body); } catch { return respond(res, 400, { error: 'Invalid JSON.' }); }
      try {
        const result = await store.updateCreatorProfile(String(session.user.id), state => {
          if (url.pathname.endsWith('/profile')) return updateCreatorProfile(state, session.user, input);
          if(url.pathname.endsWith('/preferences')) {
            if(!Array.isArray(input.following)||input.following.length>200||input.following.some(id=>typeof id!=='string'||!validXId(id)))throw new Error('Choose up to 200 valid creator accounts.');
            state.creatorProfiles ||= {};const profile=state.creatorProfiles[session.user.id] ||= {id:String(session.user.id)};
            profile.following=[...new Set(input.following)];return {following:profile.following};
          }
          const profile = state.creatorProfiles?.[session.user.id];
          if (!profile?.identityVerified || profile.optedOut || !profile.listed) throw new Error('Opt in to your public creator page before publishing updates.');
          const text = typeof input.text === 'string' ? input.text.trim() : '';
          if (!text || text.length > 280) throw new Error('Updates must contain 1–280 characters.');
          const update = { id: randomBytes(12).toString('hex'), text, createdAt: new Date().toISOString() };
          profile.updates = [...(profile.updates || []), update].slice(-20); return update;
        });
        return respond(res, 200, result);
      } catch (error) { return respond(res, 400, { error: error.message }); }
    }
    if (req.method === 'GET' && url.pathname === '/api/creators') {
      const query = String(url.searchParams.get('q') || '').trim().toLowerCase().slice(0,80);
      // Directory never computes or advertises unverified earnings.
      const after=String(url.searchParams.get('after')||'');
      if(after&&!validXId(after))return respond(res,400,{error:'Invalid directory cursor.'});
      const follows=String(url.searchParams.get('ids')||'').split(',').filter(Boolean);
      if(follows.length>200||follows.some(id=>!validXId(id)))return respond(res,400,{error:'Invalid following filter.'});
      return respond(res, 200, { ...await store.readCreatorDirectory({ cluster, after, query, follows }), cluster });
    }
    const historyId=url.pathname.match(/^\/api\/creators\/(\d{1,24})\/receipts$/)?.[1];
    if(req.method==='GET'&&historyId) {
      let after;try{after=decodeReceiptCursor(url.searchParams.get('after')||'');}catch(error){return respond(res,400,{error:error.message});}
      const visible=await store.readCreatorState(historyId,cluster,{financial:false});
      if(!buildCreatorSupport(visible,historyId,null,cluster))return respond(res,404,{error:'Creator unavailable.'});
      if(!readFinalizedEvidence)return respond(res,503,{error:'Finalized receipt history is unavailable.'});
      const history=await store.readCreatorReceiptPage(historyId,cluster,after);
      const evidence=await readFinalizedEvidence(history.state).catch(()=>({status:'unavailable'}));
      // Opt-out can occur while RPC is pending. Recheck privacy before publishing.
      const refreshed=await store.readCreatorReceiptPage(historyId,cluster,after);
      const latest=await store.readCreatorState(historyId,cluster,{financial:false});
      if(!buildCreatorSupport(latest,historyId,null,cluster))return respond(res,404,{error:'Creator unavailable.'});
      if(!sameFinancialInputs(history.state,refreshed.state))return respond(res,503,{error:'Receipt records changed during verification. Retry this page; no payout was submitted.'});
      const creator=buildCreatorSupport({...refreshed.state,creatorProfiles:latest.creatorProfiles},historyId,evidence,cluster);
      return respond(res,200,{receipts:evidence.commitment==='finalized'?creator?.receipts||[]:[],nextCursor:history.nextCursor,
        checkedPayouts:history.checkedPayouts,status:evidence.status,commitment:'finalized',indexedRecords:evidence.indexedRecords||0,
        coverage:'This page verifies recorded payouts and their source collections. Missing or unmatched records are excluded; this is not lifetime earnings or a complete chain index.'});
    }
    const cardId=url.pathname.match(/^\/api\/creators\/(\d{1,24})\/card\.png$/)?.[1];
    if(req.method==='GET'&&cardId){
      const receipt=url.searchParams.get('receipt'),update=url.searchParams.get('update');
      if((receipt&&update)||(receipt&&receipt.length>100)||(update&&!/^[a-f0-9]{24}$/.test(update)))return respond(res,400,{error:'Choose one receipt or update card.'});
      const state=await store.readCreatorState(cardId,cluster,{financial:Boolean(receipt)});
      // Privacy gate before RPC; recheck evidence before returning even a cached receipt card.
      if(!buildCreatorSupport(state,cardId,null,cluster))return respond(res,404,{error:'Creator unavailable.'});
      const proof=receipt?await readEvidence(state).catch(()=>({status:'unavailable'})):null;
      // Evidence may be slow. Re-read current consent, identity and entitlement before returning cached or new media.
      const latest=await store.readCreatorState(cardId,cluster,{financial:Boolean(receipt)});
      const c=buildCreatorSupport(latest,cardId,proof,cluster);
      if(!c)return respond(res,404,{error:'Creator unavailable.'});
      if(receipt&&!sameFinancialInputs(state,latest))return respond(res,503,{error:'Receipt records changed. Refresh before downloading.'});
      let detail=null;
      if(receipt){const row=c.receipts.find(row=>row.signature===receipt);if(!row)return respond(res,404,{error:'Receipt is not verified in the current evidence window.'});detail={type:'receipt',...row};}
      if(update){const row=c.updates.find(row=>row.id===update);if(!row)return respond(res,404,{error:'Update is unavailable.'});detail={type:'update',...row};}
      const key=JSON.stringify([c.id,c.handle,cluster,detail]);
      if(!cards.has(key)){if(cards.size>=100)cards.delete(cards.keys().next().value);cards.set(key,creatorCardPng(c.handle,cluster,detail));}
      const png=cards.get(key);res.writeHead(200,{'content-type':'image/png','content-length':png.length,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(png);return true;
    }
    const id = url.pathname.match(/^\/api\/creators\/(\d{1,24})$/)?.[1];
    if (req.method === 'GET' && id) {
      const state = await store.readCreatorState(id,cluster,{financial:url.searchParams.get('view')!=='updates'});
      if (!buildCreatorSupport(state,id,null,cluster)) return respond(res,404,{error:'Creator page is unavailable or excluded from discovery.'});
      const financial=url.searchParams.get('view')!=='updates';
      const proof=financial?await readEvidence(state).catch(()=>({status:'unavailable'})):null;
      const latest=financial?await store.readCreatorState(id,cluster):state;
      const creator = buildCreatorSupport(latest, id, proof, cluster);
      if(creator&&financial&&!sameFinancialInputs(state,latest))return respond(res,503,{error:'Receipt records changed during verification. Refresh this creator page.'});
      return respond(res, creator ? 200 : 404, creator || { error: 'Creator page is unavailable or excluded from discovery.' });
    }
    return respond(res, 404, { error: 'Creator support route not found.' });
  };
}
