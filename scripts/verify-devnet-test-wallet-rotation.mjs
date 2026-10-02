import assert from 'node:assert/strict';
import { replaceDevnetTestWallets } from './rotate-devnet-test-wallets.mjs';

const original = [
  'VITE_DEV_MODE=true',
  'VITE_DEV_AUTOCONNECT=true',
  'VITE_SOLANA_CLUSTER=devnet',
  'DEV_MODE=true',
  'SOLANA_CLUSTER=devnet',
  'SOLANA_DEVNET_CREATOR_SECRET_KEY=old-creator',
  'SOLANA_DEVNET_REFERRER_SECRET_KEY=old-referrer',
  'SOLANA_DEVNET_CLAIMANT_SECRET_KEY=old-claimant',
  'FUNDED_ROUTER_AUTHORITY_SECRET_KEY=unchanged-authority',
].join('\n');
const replacements = { creator: 'new-creator', referrer: 'new-referrer', claimant: 'new-claimant' };
const result = replaceDevnetTestWallets(original, replacements);
for (const [role, value] of Object.entries(replacements)) {
  assert.match(result, new RegExp(`SOLANA_DEVNET_${role.toUpperCase()}_SECRET_KEY=${value}`));
  assert.doesNotMatch(result, new RegExp(`old-${role}`));
}
assert.match(result, /FUNDED_ROUTER_AUTHORITY_SECRET_KEY=unchanged-authority/);
assert.equal(replaceDevnetTestWallets(original.replaceAll('\n', '\r\n'), replacements), result.replaceAll('\n', '\r\n'));
assert.throws(() => replaceDevnetTestWallets(original.replace('VITE_SOLANA_CLUSTER=devnet', 'VITE_SOLANA_CLUSTER=mainnet-beta'), replacements), /VITE_SOLANA_CLUSTER/);
assert.throws(() => replaceDevnetTestWallets(`${original}\nSOLANA_DEVNET_CREATOR_SECRET_KEY=duplicate`, replacements), /SOLANA_DEVNET_CREATOR_SECRET_KEY/);
assert.throws(() => replaceDevnetTestWallets(original.replace('SOLANA_DEVNET_CLAIMANT_SECRET_KEY=old-claimant', ''), replacements), /SOLANA_DEVNET_CLAIMANT_SECRET_KEY/);
console.log('Devnet test-wallet rotation validation passed using synthetic values only.');
