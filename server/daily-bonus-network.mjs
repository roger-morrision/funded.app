import {requireSolanaCluster,assertRpcNetwork} from '../solana-network.js';
import {financialRecordNetwork} from './financial-network.mjs';
import {PublicKey} from '@solana/web3.js';

export function assertBonusNetwork(cluster,{window,schedule}={}) {
  requireSolanaCluster(cluster);
  if(cluster!=='devnet'&&(window?.qa||window?.periodSeconds!=null&&window.periodSeconds!==86400
    ||schedule&&schedule.periodSeconds!==86400||schedule?.mints||schedule?.allMints))
    throw Error('QA bonus windows are forbidden outside Devnet.');
}

export async function assertBonusRpc(connection,cluster,options) {
  assertBonusNetwork(cluster,options);
  await assertRpcNetwork(connection,cluster);
}

export function assertBonusSnapshotNetwork(snapshot,cluster,programId) {
  assertBonusNetwork(cluster,{window:snapshot});
  if(!financialRecordNetwork(snapshot,cluster,{legacyDevnet:true})
    ||cluster==='mainnet-beta'&&snapshot.programId!==programId)
    throw Error('Daily bonus snapshot belongs to another network or program.');
  if(cluster==='mainnet-beta')new PublicKey(programId);
}

export function bonusSnapshotIdentity(cluster,programId,window) {
  assertBonusNetwork(cluster,{window});
  return cluster==='mainnet-beta'?{cluster,programId:new PublicKey(programId).toBase58()}:{};
}

export function assertBonusLedgerNetwork(ledger,cluster,programId) {
  for(const row of Object.values(ledger.dailyBonusSnapshots||{}))
    assertBonusSnapshotNetwork(row.snapshot,cluster,programId);
}
