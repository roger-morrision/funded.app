// Cooperative single-workspace maintenance guard. Linux flock serializes every
// mutation; TTL never grants permission to displace a live owner or kill a PID.
import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { hostname } from 'node:os';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url);
export const DEFAULT_LEASE_PATH = '/workspace/funded-maintenance/lease.json';
const hash = token => createHash('sha256').update(token).digest('hex');
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
function ttl(value = 50 * 60_000) {
  if (!Number.isSafeInteger(value) || value < 1000 || value > 2 * 60 * 60_000) throw new Error('TTL must be between 1 second and 2 hours.');
  return value;
}
function identity(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('A positive owner PID is required.');
  try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return null; if (error.code !== 'EPERM') throw error; }
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const tail = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    // A zombie cannot perform work even though kill(pid, 0) still succeeds.
    if (tail[0] === 'Z') return null;
    return { host: hostname(), bootId: readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(), startTicks: tail[19] };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    return { host: hostname(), unknown: true };
  }
}
function inspect(path) {
  let lease;
  try { lease = JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return { status: 'unlocked' }; return { status: 'invalid-lease', blocked: true }; }
  if (lease.version !== 1 || !Number.isSafeInteger(lease.ownerPid) || lease.ownerPid < 1 || !Number.isFinite(lease.expiresAt) || !/^[a-f0-9]{64}$/.test(lease.tokenHash) || !lease.identity?.host || !/^[a-f0-9-]{36}$/.test(lease.identity.bootId || '') || !/^\d+$/.test(lease.identity.startTicks || '') || !Number.isFinite(lease.acquiredAt) || !/^[a-f0-9-]{36}$/.test(lease.runId || '')) return { status: 'invalid-lease', blocked: true };
  const expired = Date.now() >= lease.expiresAt;
  if (lease.identity.host !== hostname()) return { status: 'unknown-host', blocked: true, lease };
  const current = identity(lease.ownerPid);
  const unknown = current?.unknown || lease.identity.unknown;
  const alive = Boolean(current && (unknown || (current.bootId === lease.identity.bootId && current.startTicks === lease.identity.startTicks)));
  return { status: alive ? (expired ? 'expired-live' : 'active') : expired ? 'expired-stale' : 'abandoned-waiting',
    blocked: alive || !expired, alive, expired, lease };
}
function save(path, lease) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { writeFileSync(temporary, JSON.stringify(lease) + '\n', { mode: 0o600, flag: 'wx' }); renameSync(temporary, path); }
  finally { try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
}
function publicStatus(state) {
  const { lease, ...status } = state;
  return { ...status, ...(lease ? { ownerPid: lease.ownerPid, ownerHost: lease.identity.host, acquiredAt: lease.acquiredAt, expiresAt: lease.expiresAt, runId: lease.runId } : {}) };
}
function underLock(action, options) {
  const path = options.path;
  const state = inspect(path);
  if (action === 'status') return publicStatus(state);
  if (action === 'acquire') {
    const duration = ttl(options.ttlMs);
    const ownerIdentity = identity(options.ownerPid);
    if (!ownerIdentity || ownerIdentity.unknown) throw new Error('Owner PID must be live with a readable Linux process identity.');
    if (state.status !== 'unlocked' && state.status !== 'expired-stale') return { acquired: false, ...publicStatus(state) };
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    const lease = { version: 1, ownerPid: options.ownerPid, identity: ownerIdentity, acquiredAt: now, expiresAt: now + duration, tokenHash: hash(token), runId: randomUUID() };
    save(path, lease);
    return { acquired: true, token, reclaimedExpiredOwner: state.status === 'expired-stale', ...publicStatus({ status: 'active', blocked: true, alive: true, expired: false, lease }) };
  }
  if (!tokenPattern.test(options.token || '')) throw new Error('The current run ownership token is required.');
  if (state.status === 'unlocked' && action === 'release') return { released: false, status: 'unlocked' };
  if (!state.lease || hash(options.token) !== state.lease.tokenHash) throw new Error('Ownership token does not match the maintenance run.');
  if (action === 'release') { unlinkSync(path); return { released: true, status: 'unlocked' }; }
  if (action === 'renew') {
    if (!state.alive) throw new Error('Only a live owner can renew a maintenance run.');
    state.lease.expiresAt = Date.now() + ttl(options.ttlMs);
    save(path, state.lease);
    return publicStatus(inspect(path));
  }
  throw new Error('Unknown maintenance lock operation.');
}

export function maintenanceLease(action, options = {}) {
  const path = resolve(options.path || DEFAULT_LEASE_PATH);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  // Never unlink the .flock file: replacing its inode would split the mutex.
  const result = spawnSync('flock', ['--exclusive', '--wait', '5', `${path}.flock`, process.execPath, script, '--under-flock', JSON.stringify({ action, options: { ...options, path } })], { encoding: 'utf8', timeout: 10_000 });
  if (result.error) throw new Error(`Maintenance guard unavailable: ${result.error.code || 'execution failed'}`);
  if (result.status !== 0) throw new Error(result.stderr.trim() || 'Maintenance guard is busy or unavailable.');
  return JSON.parse(result.stdout);
}

async function main(args) {
  if (args[0] === '--under-flock') {
    const { action, options } = JSON.parse(args[1]);
    console.log(JSON.stringify(underLock(action, options))); return;
  }
  const [action, ...parameters] = args;
  if (!['status', 'acquire', 'renew', 'release', 'hold'].includes(action)) throw new Error('Usage: maintenance-run-lock.mjs status|acquire|hold|renew|release [--path FILE] [--owner-pid PID] [--ttl-seconds N] [--token-file FILE]');
  const flags = {};
  for (let i = 0; i < parameters.length; i += 2) {
    if (!['--path', '--owner-pid', '--ttl-seconds', '--token-file'].includes(parameters[i]) || !parameters[i + 1]) throw new Error('Invalid maintenance guard option.');
    flags[parameters[i]] = parameters[i + 1];
  }
  const options = { path: flags['--path'], ...(flags['--ttl-seconds'] ? { ttlMs: Number(flags['--ttl-seconds']) * 1000 } : {}) };
  if (action === 'acquire') options.ownerPid = Number(flags['--owner-pid']);
  if (action === 'hold') options.ownerPid = process.pid;
  if (['renew', 'release'].includes(action)) {
    if (!flags['--token-file']) throw new Error('Pass the token file created for this run.');
    options.token = readFileSync(flags['--token-file'], 'utf8').trim();
  }
  const result = maintenanceLease(action === 'hold' ? 'acquire' : action, options);
  if (result.token && flags['--token-file']) {
    try { writeFileSync(flags['--token-file'], result.token + '\n', { mode: 0o600, flag: 'wx' }); }
    catch (error) { maintenanceLease('release', { ...options, token: result.token }); throw error; }
  }
  const token = result.token;
  console.log(JSON.stringify(flags['--token-file'] ? { ...result, token: undefined, tokenFile: flags['--token-file'] } : result));
  if (result.acquired === false) { process.exitCode = 2; return; }
  if (action !== 'hold') return;
  let warned = false;
  const timer = setInterval(() => {
    try {
      const state = maintenanceLease('status', options);
      if (state.runId !== result.runId) { clearInterval(timer); return; }
      if (state.status === 'expired-live' && !warned) { console.error('Maintenance lease expired while its holder is live. Finish or renew; later runs remain blocked.'); warned = true; }
    } catch { console.error('Maintenance guard status unavailable; stop new edits until ownership is verified.'); }
  }, 5000);
  const stop = () => {
    try { maintenanceLease('release', { ...options, token }); } catch { /* Ownership may already have been released. */ }
    clearInterval(timer);
  };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
if (process.argv[1] && resolve(process.argv[1]) === script) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
