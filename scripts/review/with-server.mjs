// Runs a command against the local review server: starts it on :5180, sets
// REVIEW_BASE_URL and SMOKE_BASE_URL, runs the command, stops the server.
//   node scripts/review/with-server.mjs npx playwright test
import { spawn } from 'node:child_process';

const [command, ...args] = process.argv.slice(2);
if (!command) { console.error('Usage: node scripts/review/with-server.mjs <command> [args]'); process.exit(2); }
const server = spawn(process.execPath, ['scripts/review/serve.mjs'], { stdio: ['ignore', 'ignore', 'inherit'] });
const base = 'http://localhost:5180';
for (let i = 0; i < 50; i++) {
  try { if ((await fetch(base + '/')).ok) break; } catch {}
  await new Promise(done => setTimeout(done, 200));
}
const run = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, REVIEW_BASE_URL: base, SMOKE_BASE_URL: base, BASE: base } });
run.on('exit', code => { server.kill(); process.exit(code ?? 1); });
