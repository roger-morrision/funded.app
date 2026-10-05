import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { verifyContainerBuildIdentity, verifyContainerBrowser } from '../scripts/verify-container-browser.mjs';

const revision = 'a'.repeat(40);
const otherRevision = 'b'.repeat(40);
async function endpoint(t, handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}
function json(response, body, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

test('identity preflight requires an explicit full SHA and safe loopback origin before fetching', async () => {
  for (const expected of [undefined, '', 'local', 'a'.repeat(39), revision + '\n']) {
    await assert.rejects(verifyContainerBuildIdentity('http://127.0.0.1:1', expected), /FUNDED_EXPECT_BUILD/);
  }
  for (const origin of ['https://example.com', 'http://user:pass@localhost', 'http://localhost/path', 'http://localhost/?q=1', 'http://localhost/#x']) {
    await assert.rejects(verifyContainerBuildIdentity(origin, revision), /loopback/);
  }
});

test('real loopback preflight returns explicit expected and observed server identity', async t => {
  const base = await endpoint(t, (request, response) => {
    assert.equal(request.url, '/api/capabilities');
    json(response, { build: revision, cluster: 'devnet' });
  });
  assert.deepEqual(await verifyContainerBuildIdentity(base, revision), { base, expectedBuild: revision, observedBuild: revision });
});

test('HTTP errors, malformed JSON, absent or mismatched builds and wrong clusters fail closed', async t => {
  let reply;
  const base = await endpoint(t, (_request, response) => reply(response));
  for (const [body, status, message] of [
    [{ build: revision, cluster: 'devnet' }, 503, /HTTP 200/],
    [{ cluster: 'devnet' }, 200, /FUNDED_EXPECT_BUILD/],
    [{ build: otherRevision, cluster: 'devnet' }, 200, /FUNDED_EXPECT_BUILD/],
    [null, 200, /FUNDED_EXPECT_BUILD/],
    [{ build: revision, cluster: 'mainnet-beta' }, 200, /Devnet/],
  ]) {
    reply = response => json(response, body, status);
    await assert.rejects(verifyContainerBuildIdentity(base, revision), message);
  }
  reply = response => response.end('<html>not JSON</html>');
  await assert.rejects(verifyContainerBuildIdentity(base, revision), SyntaxError);
});

test('identity requests never follow redirects, including another local endpoint', async t => {
  let destinationRequests = 0;
  const target = await endpoint(t, (_request, response) => { destinationRequests++; json(response, { build: revision, cluster: 'devnet' }); });
  const base = await endpoint(t, (_request, response) => { response.writeHead(302, { location: target }); response.end(); });
  await assert.rejects(verifyContainerBuildIdentity(base, revision), /fetch failed/);
  assert.equal(destinationRequests, 0);
});

test('CLI rejects missing and wrong build before trying the nonexistent Chromium executable', async t => {
  const base = await endpoint(t, (_request, response) => json(response, { build: otherRevision, cluster: 'devnet' }));
  for (const expected of ['', revision]) {
    const child = spawn(process.execPath, ['scripts/verify-container-browser.mjs'], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, FUNDED_CONTAINER_BASE: base, FUNDED_EXPECT_BUILD: expected, CHROMIUM_PATH: '/missing-chromium-identity-test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const [code] = await once(child, 'close');
    assert.notEqual(code, 0); assert.equal(stdout, '');
    assert.match(stderr, /FUNDED_EXPECT_BUILD/); assert.doesNotMatch(stderr, /browserType\.launch|executable doesn't exist/);
  }
});

// These are orchestration fixtures, not product browser coverage. No Chromium
// process starts; real loopback identity requests still run before and after.
function browserFixture() {
  let closed = 0;
  return {
    get closed() { return closed; },
    async close() { closed++; },
    async newContext() {
      return {
        async close() {},
        async newPage() {
          return {
            on() {}, async goto() { return { status: () => 200 }; },
            locator() { return { async waitFor() {}, async innerText() { return 'Saved records Available'; } }; },
            getByRole() { return { async click() {} }; },
            async evaluate() { return false; }, async close() {},
          };
        },
      };
    },
  };
}

test('successful orchestration reports both identity observations and closes the browser', async t => {
  let requests = 0;
  const base = await endpoint(t, (_request, response) => { requests++; json(response, { build: revision, cluster: 'devnet' }); });
  const browser = browserFixture();
  const report = await verifyContainerBrowser({ env: { FUNDED_CONTAINER_BASE: base, FUNDED_EXPECT_BUILD: revision }, launchBrowser: async () => browser });
  assert.equal(requests, 2); assert.equal(browser.closed, 1);
  assert.equal(report.expectedBuild, revision); assert.equal(report.observedBuild, revision);
  assert.equal(report.base, base); assert.equal(report.identityCheckedBeforeAndAfter, true);
  assert.match(report.identityScope, /asset bytes require the separate/); assert.equal(report.passed, 6);
});

test('a changed build after the browser checks rejects the result and still closes the browser', async t => {
  let requests = 0;
  const base = await endpoint(t, (_request, response) => json(response, { build: ++requests === 1 ? revision : otherRevision, cluster: 'devnet' }));
  const browser = browserFixture();
  await assert.rejects(verifyContainerBrowser({ env: { FUNDED_CONTAINER_BASE: base, FUNDED_EXPECT_BUILD: revision }, launchBrowser: async () => browser }), /FUNDED_EXPECT_BUILD/);
  assert.equal(requests, 2); assert.equal(browser.closed, 1);
});
