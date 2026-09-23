import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPostgresStore } from './postgres-store.mjs';
import { coinFeeActivity, routerFeeActivity } from './fee-activity.mjs';
import { createFileAuthStore } from './file-auth-store.mjs';
import { creatorDirectoryRecords, directoryPage } from './creator-directory.mjs';
import { scopedCreatorState, creatorWriteState, mutateCreatorState } from './creator-state.mjs';
import { selectReceiptCandidates } from './receipt-candidates.mjs';
import { creatorReceiptPage } from './receipt-history.mjs';
import { receiptBackfillPage } from './receipt-backfill.mjs';
import { scopedClaimState,mutateClaimState } from './claim-state.mjs';
import {scopedReferralClaimState,mutateReferralClaimState} from './referral-claim-state.mjs';
import { followingUpdatesPage } from './following-updates.mjs';
import { receiptWorkerOutcome } from './receipt-worker-status.mjs';
import { receiptRetentionOptions,expiredReceiptProofs,receiptRetentionResult } from './receipt-retention.mjs';

export function createStore(filePath = resolve(process.cwd(), 'data', 'funded-store.json'), databaseUrl = process.env.DATABASE_URL) {
  if (databaseUrl) return createPostgresStore(databaseUrl);
  let state = { version: 3, launches: {}, settlements: {}, obligations: {}, claims: {}, referralClaims: {}, payouts: {}, collections: {}, launchReviews: {}, alerts: {}, xIntake: {}, marketActivity: {}, coinChats: {}, referrals: { codes: {}, wallets: {}, attributions: {}, challenges: {} } };
  let loaded = false;
  let updateQueue = Promise.resolve();
  const rpcRates = new Map();
  let rpcWindowStart = null;

  async function load() {
    if (loaded) return state;
    try { state = { ...state, ...JSON.parse(await readFile(filePath, 'utf8')) }; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    state.referralClaims ||= {};
    state.collections ||= {};
    state.launchReviews ||= {};
    state.alerts ||= {};
    state.xIntake ||= {};
    state.marketActivity ||= {};
    state.coinChats ||= {};
    state.creatorProfiles ||= {};
    state.referrals ||= { codes: {}, wallets: {}, attributions: {}, challenges: {} };
    state.referrals.codes ||= {};
    state.referrals.wallets ||= {};
    state.referrals.attributions ||= {};
    state.referrals.challenges ||= {};
    state.version = Math.max(3, Number(state.version) || 1);
    loaded = true;
    return state;
  }

  async function save(nextState) {
    await mkdir(dirname(filePath), { recursive: true });
    const temp = `${filePath}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(nextState, null, 2), 'utf8');
    try {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        try { await rename(temp, filePath); return; }
        catch (error) {
          if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt === 5) throw error;
          await new Promise(resolve => setTimeout(resolve, 20 * (attempt + 1)));
        }
      }
    } finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }

  return {
    ...createFileAuthStore(`${filePath}.auth.json`),
    async readFollowingUpdates(cluster,ids,after='') {const state=await load();return followingUpdatesPage(creatorDirectoryRecords(state,cluster),state.creatorProfiles||{},ids,after);},
    async readClaimState(id) {return scopedClaimState(await load(),id);},
    async readReferralClaimState(id) {return scopedReferralClaimState(await load(),id);},
    async updateReferralClaimState(id,mutator) {
      return this.update(async current=>{
        const scoped=scopedReferralClaimState(current,id),output=await mutateReferralClaimState(scoped,id,mutator);
        current.referralClaims[id]=scoped.referralClaims[id];
        if(scoped.payouts[`referral:${id}`])current.payouts[`referral:${id}`]=scoped.payouts[`referral:${id}`];
        return output;
      });
    },
    async updateClaimState(id,mutator) {
      return this.update(async current=>{const scoped=scopedClaimState(current,id),output=await mutateClaimState(scoped,id,mutator);
        if(scoped.claims[id])current.claims[id]=scoped.claims[id];
        if(scoped.payouts[`x:${id}`])current.payouts[`x:${id}`]=scoped.payouts[`x:${id}`];return output;});
    },
    async readReceiptBackfillPage(cluster,position) { return receiptBackfillPage(await load(),cluster,position); },
    async acquireReceiptBackfill(cluster,owner,leaseMs) {
      return this.update(current=>{current.receiptBackfill ||= {};const prior=current.receiptBackfill[cluster];
        if(prior?.owner&&prior.expiresAt>Date.now())return null;
        const row={owner,expiresAt:Date.now()+leaseMs,progress:prior?.progress||{},lastRun:prior?.lastRun||null};current.receiptBackfill[cluster]=row;return structuredClone(row.progress);});
    },
    async checkpointReceiptBackfill(cluster,owner,progress,leaseMs) {
      return this.update(current=>{const row=current.receiptBackfill?.[cluster];if(row?.owner!==owner||row.expiresAt<=Date.now())return false;
        row.progress=structuredClone(progress);row.expiresAt=Date.now()+leaseMs;return true;});
    },
    async releaseReceiptBackfill(cluster,owner) {
      return this.update(current=>{const row=current.receiptBackfill?.[cluster];if(row?.owner===owner){row.owner=null;row.expiresAt=0;}});
    },
    async readReceiptBackfillStatus(cluster) {return structuredClone((await load()).receiptBackfill?.[cluster]||null);},
    async recordReceiptBackfillOutcome(cluster,owner,outcome) {
      const clean=receiptWorkerOutcome(outcome);
      return this.update(current=>{const row=current.receiptBackfill?.[cluster];if(row?.owner!==owner||row.expiresAt<=Date.now())return false;row.lastRun=clean;return true;});
    },
    async readCreatorReceiptPage(id, cluster, after = '') { return creatorReceiptPage(await load(), id, cluster, after); },
    async readReceiptProofs(keys) { const proofs=(await load()).receiptProofs || {};return structuredClone(keys.map(key=>proofs[key]).filter(Boolean)); },
    async writeReceiptProofs(entries) { return this.update(current=>{current.receiptProofs ||= {};for(const entry of entries)current.receiptProofs[entry.key]=entry;}); },
    async pruneReceiptProofs(input) {
      const options=receiptRetentionOptions(input);
      const run=current=>{const rows=expiredReceiptProofs(current.receiptProofs,options),selected=rows.slice(0,options.limit);
        if(options.apply)for(const [key] of selected)delete current.receiptProofs[key];
        return receiptRetentionResult(options,selected.length,rows.length>options.limit,options.apply?selected.length:0);};
      return options.apply?this.update(run):run(await load());
    },
    async updateCreatorProfile(id, mutator) {
      return this.update(async current => {
        const scoped = creatorWriteState(current, id);
        const output = await mutateCreatorState(scoped, id, mutator);
        current.creatorProfiles ||= {};
        if (scoped.creatorProfiles[id]) current.creatorProfiles[id] = scoped.creatorProfiles[id];
        else delete current.creatorProfiles[id];
        return output;
      });
    },
    async readReceiptCandidates(cluster) { return selectReceiptCandidates(await load(), cluster); },
    async readCreatorState(id, cluster, options) { return scopedCreatorState(await load(),id,cluster,options); },
    async readCreatorDirectory({ cluster, ...options }) { return directoryPage(creatorDirectoryRecords(await load(), cluster), options); },
    async read() { return structuredClone(await load()); },
    async readLaunches({ limit = null, offset = 0 } = {}) { const items = Object.values((await load()).launches || {}); return limit == null ? items : items.slice(offset, offset + limit); },
    async readLaunch(mint) { return (await load()).launches?.[mint] || null; },
    async writeMetadata(record, image, imageType) {
      const metadataPath = `${filePath}.metadata.${record.mint}.json`;
      await mkdir(dirname(metadataPath), { recursive: true });
      try { await writeFile(metadataPath, JSON.stringify({ record, image: image?.toString('base64') || '', imageType }), { encoding: 'utf8', flag: 'wx' }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      const existing = JSON.parse(await readFile(metadataPath, 'utf8'));
      if (JSON.stringify(existing.record) !== JSON.stringify(record)) throw new Error('Immutable Devnet metadata already exists for this mint.');
      return existing.record;
    },
    async readMetadata(mint) {
      try { return JSON.parse(await readFile(`${filePath}.metadata.${mint}.json`, 'utf8')).record; }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    async readMetadataImage(mint) {
      try { const entry = JSON.parse(await readFile(`${filePath}.metadata.${mint}.json`, 'utf8')); return entry.image ? { bytes: Buffer.from(entry.image, 'base64'), mime: entry.imageType } : null; }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    async readPublicBuckets() { return structuredClone(await load()); },
    async readReferralClaimsForWallet(wallet) { return Object.values((await load()).referralClaims || {}).filter(item => item.recipientWallet === wallet); },
    async readCoinFeeActivity(mint, cluster) { const current = await load(); return coinFeeActivity(current.collections, current.settlements, mint, cluster); },
    async readRouterFeeActivity(router, cluster) { const current = await load(); return routerFeeActivity(current.collections, router, cluster); },
    async readCoinChat(mint, limit = 50) { return (await load()).coinChats?.[mint]?.slice(-limit) || []; },
    async appendCoinChat(mint, message, limit = 100) { return this.update(current => { current.coinChats ||= {}; current.coinChats[mint] = [...(current.coinChats[mint] || []), message].slice(-limit); return message; }); },
    async update(mutator) {
      const operation = updateQueue.then(async () => { await load(); const draft = structuredClone(state); const result = await mutator(draft); await save(draft); state = draft; return result; });
      updateQueue = operation.catch(() => {});
      return operation;
    },
    async readMarketActivity(mint, cluster) { return (await load()).marketActivity[`${cluster}:${mint}`] || null; },
    async writeMarketActivity(mint, cluster, data) { await this.update(current => { current.marketActivity[`${cluster}:${mint}`] = data; }); },
    async chargeRpcRate(clientKey, units, limit, windowStart) {
      if (rpcWindowStart !== windowStart) { rpcRates.clear(); rpcWindowStart = windowStart; }
      const key = clientKey;
      const used = rpcRates.get(key) || 0;
      if (used + units > limit) return false;
      rpcRates.set(key, used + units);
      return true;
    },
    filePath,
  };
}
