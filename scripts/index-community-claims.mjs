import { readFile } from 'node:fs/promises';
import { Connection } from '@solana/web3.js';
import { createAutomaticRewardStore } from '../server/automatic-reward-store.mjs';
import { indexCommunityClaims } from '../server/community-claim-index.mjs';
import { rewardLedgerPath } from '../server/reward-ledger-path.mjs';

const rpcUrl = process.env.SOLANA_RPC_URL_FILE
  ? (await readFile(process.env.SOLANA_RPC_URL_FILE, 'utf8')).trim()
  : String(process.env.SOLANA_RPC_URL || '').trim();
if (!rpcUrl) throw new Error('A Devnet RPC URL is required.');
const result = await indexCommunityClaims({
  connection:new Connection(rpcUrl, 'finalized'),
  ledger:createAutomaticRewardStore(rewardLedgerPath()),
  programId:process.env.FUNDED_FEE_ROUTER_PROGRAM_ID,
  authority:process.env.FUNDED_REWARD_AUTHORITY,
  eligibilityMint:process.env.FUNDED_TOKEN_MINT,
  expectedProgramDataSha256:process.env.FUNDED_REWARD_PROGRAM_DATA_SHA256,
  persist:!process.argv.includes('--dry-run'),
});
console.log(JSON.stringify({ status:result.status, commitment:result.commitment,
  drops:result.drops.length, claims:result.payments.length, indexedAt:result.indexedAt,
  dryRun:process.argv.includes('--dry-run') }));
