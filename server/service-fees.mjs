import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { DEFAULT_SERVICE_FEES, validateServiceFees } from '../service-fees.js';

export function serviceFeeSnapshot(state = {}) {
  const saved = state.adminSettings?.serviceFees;
  const policy = validateServiceFees(saved?.policy || DEFAULT_SERVICE_FEES);
  const revision = saved?.revision ?? 0;
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid service fee revision.');
  return { policy, revision, hash:createHash('sha256').update(JSON.stringify({ policy, revision })).digest('hex'),
    updatedAt:saved?.updatedAt || null, appliesTo:'new quotes; issued quotes retain their approved amount until expiry' };
}
export const readServiceFees = async store => serviceFeeSnapshot(await store.read());
export function serviceFeeRecipient(env = process.env) {
  try { return new PublicKey(String(env.FUNDED_SERVICE_FEE_RECIPIENT || env.FUNDED_TRADE_FEE_OWNER || '')).toBase58(); }
  catch { throw new Error('A valid service fee treasury is required.'); }
}
export async function handleAdminServiceFees({ req, res, url, store, body, respond, session }) {
  if (url.pathname !== '/api/admin/service-fees') return false;
  if (req.method === 'GET') { respond(res,200,await readServiceFees(store)); return true; }
  if (req.method !== 'POST') { respond(res,405,{error:'Use GET or POST.'}); return true; }
  try {
    const input = await body(req), policy = validateServiceFees(input.policy);
    if (typeof input.reason !== 'string' || input.reason.trim().length < 10 || input.reason.length > 500) throw new Error('Provide a 10–500 character audit reason.');
    const value = await store.update(state => {
      const previous = serviceFeeSnapshot(state);
      if (input.expectedRevision !== previous.revision || input.expectedHash !== previous.hash) throw new Error('Service fee policy changed. Refresh before saving.');
      const updatedAt = new Date().toISOString(), revision = previous.revision + 1;
      state.adminSettings ||= {}; state.adminAudit ||= {};
      state.adminSettings.serviceFees = { policy, revision, updatedAt, updatedBy:session.wallet };
      state.adminAudit[`service-fees:${revision}`] = { action:'service-fees', previous:previous.policy, policy,
        wallet:session.wallet, reason:input.reason.trim(), revision, at:updatedAt };
      return serviceFeeSnapshot(state);
    });
    respond(res,200,value);
  } catch(error) { respond(res,409,{error:String(error.message || error)}); }
  return true;
}
