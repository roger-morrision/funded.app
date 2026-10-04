import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, request } from 'node:http';
import { readJsonBody } from '../server/request-body.mjs';

test('request parser rejects malformed, oversized, primitive and interrupted bodies without killing the server', async () => {
  const server = createServer(async (req, res) => {
    try { res.end(JSON.stringify(await readJsonBody(req, { maxBytes: 64, timeoutMs: 50 }))); }
    catch (error) {
      if (!req.complete) { res.shouldKeepAlive = false; res.setHeader('connection', 'close'); }
      res.statusCode = error.statusCode;
      res.end(error.message);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const raw of ['null', '[]', '1', '"value"', '{']) {
      assert.equal((await fetch(origin, { method: 'POST', body: raw })).status, 400);
    }
    assert.equal((await fetch(origin, { method: 'POST', body: JSON.stringify({ text: 'x'.repeat(65) }) })).status, 413);
    assert.equal((await fetch(origin, { method: 'POST', body: '{}', headers: { 'content-encoding': 'gzip' } })).status, 415);
    const timeout = await new Promise((resolve, reject) => {
      const req = request(origin, { method: 'POST', headers: { 'transfer-encoding': 'chunked' } }, res => { res.resume(); res.once('end', () => resolve(res.statusCode)); });
      req.on('error', reject);
      req.write('{');
    });
    assert.equal(timeout, 408);
    const streamed = await new Promise((resolve, reject) => {
      const req = request(origin, { method: 'POST' }, res => { res.resume(); res.once('end', () => resolve(res.statusCode)); });
      req.on('error', reject);
      req.write('x'.repeat(100));
    });
    assert.equal(streamed, 413);
    assert.deepEqual(await (await fetch(origin, { method: 'POST', body: '{"ok":true}' })).json(), { ok: true });
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
