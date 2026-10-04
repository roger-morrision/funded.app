import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('static responses preserve MIME/cache policy and serve pilot deep links', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'funded-static-http-'));
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  await mkdir(join(directory, 'dist', 'assets'), { recursive:true });
  const indexHtml='<!doctype html><html><body><main id="pilot-static-fixture">Application shell</main></body></html>';
  await writeFile(join(directory, 'dist', 'index.html'), indexHtml);
  const fixtures = [
    ['build-settings.json', 'application/json; charset=utf-8', Buffer.from('{"cluster":"devnet"}')],
    ['poster.webp', 'image/webp', Buffer.from('RIFFfixtureWEBP')],
    ['poster.avif', 'image/avif', Buffer.from('fixtureftypavif')],
    ['assets/artwork-AbC_1234.webp', 'image/webp', Buffer.from('RIFFhashedWEBP')],
  ];
  for (const [path,, bytes] of fixtures) await writeFile(join(directory, 'dist', path), bytes);
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server/index.mjs', import.meta.url))], {
    cwd:directory, stdio:'ignore', env:{ ...process.env, FUNDED_SKIP_LOCAL_ENV:'true', NODE_ENV:'test',
      DATABASE_URL:'', HOST:'127.0.0.1', PORT:String(port), FUNDED_STORE_PATH:join(directory, 'state.json'),
      VITE_SOLANA_CLUSTER:'devnet', SOLANA_RPC_URL:'http://127.0.0.1:9', DEV_MODE:'false', DEVNET_TEST_MODE:'false' },
  });
  const origin = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try { if ((await fetch(`${origin}/poster.webp`)).ok) { ready = true; break; } } catch {}
      if (child.exitCode != null) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(ready, 'Isolated API must serve the static fixture.');
    for (const [path, mime, bytes] of fixtures) {
      const response = await fetch(`${origin}/${path}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), mime);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('cache-control'), path.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    }
    for(const path of ['/pilot','/pilot/','/pilot?source=creator-invite']){
      const response=await fetch(`${origin}${path}`);
      assert.equal(response.status,200,`Pilot deep link must serve the application shell: ${path}`);
      assert.match(response.headers.get('content-type'),/^text\/html/);
      assert.equal(response.headers.get('cache-control'),'no-cache');
      assert.equal(await response.text(),indexHtml);
    }
    assert.equal((await fetch(`${origin}/pilot/not-a-page`)).status,404,'Unrecognized nested paths must not become SPA routes.');
  } finally {
    if (child.exitCode == null) { const stopped = once(child, 'exit'); child.kill(); await stopped; }
    await rm(directory, { recursive:true, force:true });
  }
});
