import { Connection } from '@solana/web3.js';
import { createAdminWallets } from './admin-wallets.mjs';
import { deliverAdminAlert } from './admin-email-delivery.mjs';
import { createOutflowWatcher, startOutflowAlerts as schedule, watchedWallets, programVaults } from './outflow-alerts.mjs';

// Wires the outflow watcher to this server's wallets, program and admin email.
export function startOutflowAlerts({ store, solanaCluster, solanaRpcUrl, keeperKeypair, referralPayoutKeypair, v3AuthorityKeypair,
  env = process.env, logger = console }) {
  // Mainnet never touches key loaders: it watches wallets by configured address only.
  const keys = solanaCluster === 'mainnet-beta' ? {} : { keeperKeypair, v3AuthorityKeypair, referralPayoutKeypair };
  const inventory = createAdminWallets({ env, ...keys });
  const programId = solanaCluster === 'devnet' ? env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID || null : null;
  let authority = null;
  try { authority = keys.v3AuthorityKeypair?.()?.publicKey?.toBase58() || null; } catch {}
  let connection;
  const watcher = createOutflowWatcher({ store, programId, expectedAuthority: authority, env, logger,
    connection: () => (connection ||= new Connection(solanaRpcUrl, 'finalized')),
    accounts: async () => {
      const rows = watchedWallets({ env, roles: inventory.roles });
      if (!programId) return rows;
      const mints = Object.entries((await store.read()).launches || {})
        .filter(([, launch]) => launch?.pumpFeeRoute?.programId === programId).map(([mint]) => mint);
      return [...rows, ...programVaults({ programId, authority, mints })];
    },
    sendAlert: ({ subject, lines }) => deliverAdminAlert({ env, subject, lines, cluster: solanaCluster,
      origin: env.PUBLIC_APP_URL || env.CORS_ORIGIN || '' }) });
  return schedule({ watcher, env, logger });
}
