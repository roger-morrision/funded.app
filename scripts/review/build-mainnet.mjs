// Builds the Mainnet browser bundle into tmp/review/dist with the same build
// settings ship.sh passes to the production image (no secrets involved).
import { spawnSync } from 'node:child_process';

const env = {
  ...process.env,
  VITE_API_BASE_URL: '/', VITE_SOLANA_CLUSTER: 'mainnet-beta', VITE_EXPLORE_CLUSTER: 'mainnet-beta',
  VITE_ALLOW_MAINNET: 'true', VITE_MAINNET_READ_ONLY: 'false',
  VITE_DEV_MODE: 'false', VITE_DEV_AUTOCONNECT: 'false',
  VITE_FUNDED_TRADE_FEE_OWNER: 'M1HfA8vPXwGGn8uv5p9BZSYjsh4jhxhoMfDx2sGsj4M',
  VITE_FUNDED_TOKEN_MINT: 'Bv1a7cEj5aRnJQhMw4kRQqAFesMSd5LwcDnUzq52BMmr', VITE_FUNDED_SWAP_POOL: '', VITE_FUNDED_FEE_ROUTER_PROGRAM_ID: '',
};
const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', 'tmp/review/dist', '--emptyOutDir', '--logLevel', 'warn'], { env, stdio: 'inherit' });
if (result.error || result.signal || result.status !== 0) process.exit(result.status || 1);
console.log('Mainnet review build ready in tmp/review/dist');
