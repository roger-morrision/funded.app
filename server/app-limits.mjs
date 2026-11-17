// App limits an admin may change from the admin page. Each value replaces the
// matching environment setting; the program and signer rules are unaffected.
// Saving goes through the admin email OTP like every other admin write.
const SOL = 1_000_000_000;

export const APP_LIMITS = Object.freeze([
  { key:'FUNDED_ADMIN_WITHDRAW_MAX_LAMPORTS', group:'Admin withdrawals', label:'Maximum per withdrawal', unit:'sol', min:0, max:1000 * SOL, fallback:10 * SOL },
  { key:'FUNDED_ADMIN_WITHDRAW_DAILY_LAMPORTS', group:'Admin withdrawals', label:'Maximum per 24 hours', unit:'sol', min:0, max:5000 * SOL, fallback:20 * SOL },
  { key:'FUNDED_ADMIN_WITHDRAW_REVIEW_LAMPORTS', group:'Admin withdrawals', label:'Second-admin approval above (blank = never)', unit:'sol', min:0, max:Number.MAX_SAFE_INTEGER, fallback:Number.MAX_SAFE_INTEGER, optional:true },
  { key:'FUNDED_ADMIN_WITHDRAW_DELAY_SECONDS', group:'Admin withdrawals', label:'Delay after second-admin approval', unit:'seconds', min:0, max:7 * 86400, fallback:86400 },
  { key:'FUNDED_OUTFLOW_ALERT_LAMPORTS', group:'Outflow alerts', label:'Alert when one check sees more than', unit:'sol', min:0, max:10000 * SOL, fallback:SOL },
  { key:'FUNDED_OUTFLOW_DAILY_ALERT_LAMPORTS', group:'Outflow alerts', label:'Alert when 24 hours see more than', unit:'sol', min:0, max:100000 * SOL, fallback:5 * SOL },
]);
const BY_KEY = new Map(APP_LIMITS.map(row => [row.key, row]));
const fail = message => Object.assign(Error(message), { status:409 });

function saved(state) {
  return state?.adminSettings?.appLimits || { values:{}, revision:0, updatedAt:null, updatedBy:null };
}

// Environment with admin-saved limits applied on top.
export function effectiveEnv(env, state) {
  const values = saved(state).values || {};
  const merged = { ...env };
  for (const [key, value] of Object.entries(values)) if (BY_KEY.has(key)) merged[key] = String(value);
  return merged;
}

export function appLimitsSnapshot(state, env = process.env) {
  const current = saved(state);
  return { revision:current.revision, updatedAt:current.updatedAt, updatedBy:current.updatedBy,
    limits:APP_LIMITS.map(row => {
      const adminValue = current.values?.[row.key];
      const envValue = env[row.key] !== undefined && env[row.key] !== '' ? Number(env[row.key]) : undefined;
      const value = adminValue ?? envValue ?? row.fallback;
      return { key:row.key, group:row.group, label:row.label, unit:row.unit, min:row.min, max:row.max, optional:Boolean(row.optional),
        value:String(value), source:adminValue !== undefined ? 'admin' : envValue !== undefined ? 'environment' : 'default' };
    }) };
}

export function validateAppLimits(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw fail('Provide the limits to save.');
  const out = {};
  for (const [key, raw] of Object.entries(values)) {
    const row = BY_KEY.get(key);
    if (!row) throw fail(`${key} is not an admin-editable limit.`);
    if (raw === null) continue; // back to the environment or default value
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < row.min || value > row.max) throw fail(`${row.label} is out of range.`);
    out[key] = value;
  }
  return out;
}

export async function handleAdminAppLimits({ req, res, url, store, body, respond, session, env = process.env }) {
  if (url.pathname !== '/api/admin/app-limits') return false;
  if (req.method === 'GET') { respond(res, 200, appLimitsSnapshot(await store.read(), env)); return true; }
  if (req.method !== 'POST') { respond(res, 405, { error:'Use GET or POST.' }); return true; }
  try {
    const input = await body(req);
    const changes = validateAppLimits(input.values);
    if (typeof input.reason !== 'string' || input.reason.trim().length < 10 || input.reason.length > 500)
      throw fail('Provide a 10–500 character audit reason.');
    const value = await store.update(state => {
      const previous = saved(state);
      if (input.expectedRevision !== previous.revision) throw fail('App limits changed. Refresh before saving.');
      const values = { ...previous.values };
      for (const key of Object.keys(input.values)) delete values[key];
      Object.assign(values, changes);
      const updatedAt = new Date().toISOString(), revision = previous.revision + 1;
      state.adminSettings ||= {}; state.adminAudit ||= {};
      state.adminSettings.appLimits = { values, revision, updatedAt, updatedBy:session.wallet };
      state.adminAudit[`app-limits:${revision}`] = { action:'app-limits', previous:previous.values, values,
        wallet:session.wallet, reason:input.reason.trim(), revision, at:updatedAt };
      return appLimitsSnapshot(state, env);
    });
    respond(res, 200, value);
  } catch (error) { respond(res, error.status || 409, { error:String(error.message || error) }); }
  return true;
}
