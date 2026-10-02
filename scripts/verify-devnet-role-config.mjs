import assert from 'node:assert/strict';
import { configuredSecret, resolveDevnetBuybackConfig } from './devnet-role-config.mjs';

assert.equal(configuredSecret({ PRIMARY:'direct', PRIMARY_FILE:'ignored' }, 'PRIMARY', [], () => 'file'), 'direct');
assert.equal(configuredSecret({ PRIMARY_FILE:'path' }, 'PRIMARY', [], path => path === 'path' ? 'file-secret' : ''), 'file-secret');
const qa = resolveDevnetBuybackConfig({ SOLANA_CLUSTER:'devnet', DEVNET_TEST_MODE:'true', QA_DEVNET_BUYBACK_OPERATOR_SECRET_KEY:'operator', QA_DEVNET_ROUTER_AUTHORITY_SECRET_KEY:'authority' });
assert.equal(qa.enabled, true); assert.equal(qa.source, 'qa-role'); assert.equal(qa.operatorSecret, 'operator'); assert.equal(qa.authoritySecret, 'authority');
assert.equal(resolveDevnetBuybackConfig({ SOLANA_CLUSTER:'mainnet-beta', DEVNET_TEST_MODE:'true', QA_DEVNET_BUYBACK_OPERATOR_SECRET_KEY:'operator' }).enabled, false);
assert.equal(resolveDevnetBuybackConfig({ SOLANA_CLUSTER:'devnet', DEVNET_TEST_MODE:'false', QA_DEVNET_BUYBACK_OPERATOR_SECRET_KEY:'operator' }).enabled, false);
console.log('Devnet role configuration checks passed');
