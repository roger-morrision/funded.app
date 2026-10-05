import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderDevnetEnvironment, assertRenderBuildIdentity, assertRenderRuntimeConfig } from '../scripts/render-devnet.mjs';

const base = { RENDER_EXTERNAL_URL: 'https://funded-test.onrender.com', RENDER_GIT_COMMIT: 'a'.repeat(40) };
test('free hosting binds API and metadata to the built origin and disables signing', () => {
  const env = renderDevnetEnvironment({ ...base, VITE_SOLANA_CLUSTER: 'mainnet-beta', VITE_ALLOW_MAINNET: 'true', DEV_MODE: 'true' });
  assert.equal(env.PUBLIC_APP_URL, base.RENDER_EXTERNAL_URL);
  assert.equal(env.CORS_ORIGIN, env.PUBLIC_APP_URL);
  assert.equal(env.VITE_DEVNET_METADATA_ORIGIN, env.DEVNET_METADATA_ORIGIN);
  assert.equal(env.SOLANA_CLUSTER, 'devnet');
  assert.equal(env.VITE_SOLANA_CLUSTER, 'devnet');
  assert.equal(env.VITE_ALLOW_MAINNET, 'false');
  assert.equal(env.DEV_MODE, 'false');
  assert.equal(env.SOLANA_KEEPER_CONFIGURED, 'false');
  assert.equal(env.DATABASE_SSL, 'true');
});
test('free hosting rejects unsafe origins, unknown revisions and custody keys', () => {
  for (const url of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com/?secret=1']) {
    assert.throws(() => renderDevnetEnvironment({ ...base, PUBLIC_APP_URL: url }));
  }
  assert.throws(() => renderDevnetEnvironment({ ...base, RENDER_GIT_COMMIT: 'unknown' }));
  assert.throws(() => renderDevnetEnvironment({ ...base, SOLANA_KEEPER_SECRET_KEY: 'do-not-load' }));
  assert.throws(() => renderDevnetEnvironment({ ...base, SOLANA_KEEPER_KEYPAIR_PATH_FILE: '/do-not-load' }));
});


test('hosting startup cannot enable local env or secret-file loading', () => {
  const env = renderDevnetEnvironment({ ...base, FUNDED_SKIP_LOCAL_ENV: 'false', DATABASE_URL_FILE: '/not-loaded', FUNDED_API_TOKEN_FILE: '/not-loaded' });
  assert.equal(env.FUNDED_SKIP_LOCAL_ENV, 'true');
  assert.throws(() => assertRenderRuntimeConfig(env), /PostgreSQL DATABASE_URL is required/);
});

test('hosting identity requires the same origin and commit in build settings and clean release manifest', () => {
  const env = renderDevnetEnvironment(base);
  const built = { origin: env.PUBLIC_APP_URL, revision: env.FUNDED_BUILD_ID, cluster: 'devnet' };
  const release = { source: env.FUNDED_BUILD_ID, releaseEligible: true, dirty: false, cluster: 'devnet', mainnetEnabled: false, builtSettings: { cluster: 'devnet', exploreCluster: 'devnet', devWalletEnabled: false, mainnetEnabled: false } };
  assert.doesNotThrow(() => assertRenderBuildIdentity(env, built, release));
  for (const altered of [{ ...built, origin: 'https://other.onrender.com' }, { ...built, revision: 'b'.repeat(40) }, { ...built, cluster: 'mainnet-beta' }]) {
    assert.throws(() => assertRenderBuildIdentity(env, altered, release), /rebuild before starting/);
  }
  for (const altered of [{ ...release, source: 'b'.repeat(40) }, { ...release, dirty: true }, { ...release, releaseEligible: false }, { ...release, mainnetEnabled: true }, { ...release, builtSettings: { devWalletEnabled: true, mainnetEnabled: false } }, null]) {
    assert.throws(() => assertRenderBuildIdentity(env, built, altered), /clean Devnet release manifest/);
  }
});

test('runtime database validation neither falls back to files nor exposes malformed credentials', () => {
  const env = { DATABASE_URL: 'postgresql://user:example-password@host/database', FUNDED_API_TOKEN: 'a'.repeat(32) };
  assert.doesNotThrow(() => assertRenderRuntimeConfig(env));
  assert.throws(() => assertRenderRuntimeConfig({ ...env, FUNDED_STORE_PATH: '/tmp/data.json' }), /local file storage/);
  assert.throws(() => assertRenderRuntimeConfig({ ...env, DATABASE_URL: 'example-password malformed' }), error => /valid PostgreSQL connection string/.test(error.message) && !JSON.stringify(error).includes('example-password'));
  assert.throws(() => assertRenderRuntimeConfig({ ...env, FUNDED_API_TOKEN: ' '.repeat(32) }), /at least 32/);
});


test('build refuses a mismatched Render commit before invoking npm', () => {
  const child = spawnSync(process.execPath, ['scripts/render-devnet.mjs', '--build'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', env: {
      PATH: process.env.PATH,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'safe.directory',
      GIT_CONFIG_VALUE_0: resolve(fileURLToPath(new URL('..', import.meta.url))).replaceAll('\\', '/'),
      ...base,
    },
  });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /Render commit does not match the checked-out source/);
  assert.doesNotMatch(child.stdout, /vite build/);
});
