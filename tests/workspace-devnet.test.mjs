import assert from 'node:assert/strict';
import test from 'node:test';
import { workspaceOrigin, assertWorkspaceService } from '../scripts/workspace-devnet.mjs';

test('workspace deployment pairs localhost and Codespaces metadata with the browser origin', () => {
  assert.equal(workspaceOrigin({}), 'http://127.0.0.1:8788');
  assert.equal(workspaceOrigin({ CODESPACES:'true', CODESPACE_NAME:'funded-example-123' }), 'https://funded-example-123-8788.app.github.dev');
  assert.equal(workspaceOrigin({ FUNDED_WORKSPACE_ORIGIN:'https://devnet.example.com/' }), 'https://devnet.example.com');
});

test('workspace origin rejects missing Codespaces identity and unsafe URL overrides', () => {
  assert.throws(() => workspaceOrigin({ CODESPACES:'true' }));
  assert.throws(() => workspaceOrigin({ CODESPACES:'true', CODESPACE_NAME:'example/path' }));
  for (const origin of ['https://user:pass@example.com', 'http://example.com', 'https://example.com/path', 'https://example.com?secret=1']) {
    assert.throws(() => workspaceOrigin({ FUNDED_WORKSPACE_ORIGIN:origin }));
  }
});

test('workspace startup verifies the revision, storage, network and disabled workers before reporting success', () => {
  const health = { ok:true, service:'funded-api', external:{solanaKeeper:false, automaticRewards:false} };
  const capabilities = { cluster:'devnet', build:'expected-revision', sessions:{storage:'postgresql'} };
  assert.doesNotThrow(() => assertWorkspaceService(health, capabilities, 'expected-revision'));
  for (const response of [null, {}, {...health, ok:false}, {...health, service:'other-service'}, {...health, external:{}}, {...health, external:{solanaKeeper:true, automaticRewards:false}}, {...health, external:{solanaKeeper:false, automaticRewards:true}}]) {
    assert.throws(() => assertWorkspaceService(response, capabilities, 'expected-revision'));
  }
  for (const response of [null, {}, {...capabilities, build:'stale-revision'}, {...capabilities, cluster:'mainnet-beta'}, {...capabilities, sessions:{storage:'local-file-single-process'}}]) {
    assert.throws(() => assertWorkspaceService(health, response, 'expected-revision'));
  }
});
