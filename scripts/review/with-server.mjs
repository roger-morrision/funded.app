// A busy port must never cause checks to exercise another build or application.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);

let [command, ...args] = process.argv.slice(2);
if (!command) { console.error('Usage: node scripts/review/with-server.mjs <command> [args]'); process.exit(2); }
if (command === 'node') command = process.execPath;
// Invoke the JS CLI directly: no Windows shell interpolation of arguments.
if (command === 'npx' && args[0] === 'playwright') {
  command = process.execPath;
  args = [join(dirname(require.resolve('playwright/package.json')), 'cli.js'), ...args.slice(1)];
}
const server = spawn(process.execPath, ['scripts/review/serve.mjs'], {
  stdio: ['ignore', 'ignore', 'inherit', 'ipc'], env: { ...process.env, PORT: '0' },
});
let run;
const stop = () => { run?.kill(); server.kill(); };
process.once('exit', stop);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stop(); process.exit(1); });
try {
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Review server startup timed out.')), 15_000);
    const fail = () => { clearTimeout(timer); reject(Error('Review server failed to start.')); };
    server.once('error', fail); server.once('exit', fail);
    server.on('message', message => {
      if (message?.type !== 'review-ready' || !Number.isInteger(message.port) || message.port < 1) return;
      clearTimeout(timer); server.off('exit', fail); server.off('error', fail);
      resolve(message.port);
    });
  });
  const base = `http://127.0.0.1:${port}`;
  run = spawn(command, args, { stdio: 'inherit', env: {
    ...process.env, REVIEW_BASE_URL: base, SMOKE_BASE_URL: base, BASE: base,
  } });
  server.once('exit', () => { if (run.exitCode === null) { run.kill(); process.exitCode = 1; } });
  const code = await new Promise((resolve, reject) => {
    run.once('error', reject); run.once('exit', (code, signal) => resolve(signal ? 1 : code ?? 1));
  });
  process.exitCode = process.exitCode || code;
} catch (error) {
  console.error(error.message); process.exitCode = 1;
} finally {
  server.kill();
}
