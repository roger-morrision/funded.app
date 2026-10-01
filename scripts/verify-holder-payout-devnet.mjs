import { readFile } from 'node:fs/promises';
import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import { canonicalPumpPoolPda } from '@pump-fun/pump-swap-sdk';

const ledgerPath = process.argv[2] || 'tmp/qa-holder-qa-ledger.json';
const ledger = JSON.parse(await readFile(ledgerPath, 'utf8'));
const schedule = Object.values(ledger.schedules || {}).find(row => row.kind === 'holder' && row.status === 'paid');
if (!schedule) throw new Error('No paid holder schedule in the supplied ledger');
const connection = new Connection(process.env.SOLANA_RPC_URL || clusterApiUrl('devnet'), 'finalized');
if (await connection.getGenesisHash() !== 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG') throw new Error('RPC is not Devnet');
const program = process.env.FUNDED_FEE_ROUTER_PROGRAM_ID;
const payments = Object.entries(schedule.payments);
const pool = canonicalPumpPoolPda(new PublicKey(schedule.mint), NATIVE_MINT).toBase58();
const poolExcluded = !payments.some(([wallet]) => wallet === pool);
const signatures = [schedule.cycleSignature, ...payments.map(([, row]) => row.signature)];
const [cycle, statuses, accounts] = await Promise.all([
  connection.getAccountInfo(new PublicKey(schedule.cycle), 'finalized'),
  connection.getSignatureStatuses(signatures, { searchTransactionHistory:true }),
  connection.getMultipleAccountsInfo(payments.map(([, row]) => new PublicKey(row.payment)), 'finalized'),
]);
const results = payments.map(([wallet, row], index) => {
  const account = accounts[index], data = account?.data;
  return { wallet, amount:row.amount, signature:row.signature, payment:row.payment,
    verified:account?.owner?.toBase58() === program && data?.length >= 92
      && new PublicKey(data.subarray(8, 40)).toBase58() === schedule.cycle
      && new PublicKey(data.subarray(40, 72)).toBase58() === wallet
      && String(data.readBigUInt64LE(72)) === row.amount
      && statuses.value[index + 1]?.confirmationStatus === 'finalized' && statuses.value[index + 1]?.err === null };
});
const total = results.reduce((sum, row) => sum + BigInt(row.amount), 0n);
const cycleDistributed = cycle?.data?.length >= 173 ? cycle.data.readBigUInt64LE(144) : -1n;
const verified = cycle?.owner?.toBase58() === program && statuses.value[0]?.confirmationStatus === 'finalized'
  && statuses.value[0]?.err === null && results.length === schedule.manifest.leaves.length
  && results.every(row => row.verified) && total === BigInt(schedule.manifest.totalAmount)
  && cycleDistributed === total && (!process.argv.includes('--expect-no-pool') || poolExcluded);
console.log(JSON.stringify({ cluster:'devnet', mint:schedule.mint, periodStart:schedule.periodStart,
  cutoffAt:schedule.cutoffAt, snapshotCount:schedule.snapshotSlots?.length, cycle:schedule.cycle,
  totalPaidLamports:String(total), remainderLamports:schedule.remainderAmount,
  distributedOnChainLamports:String(cycleDistributed), poolExcluded, verified, payments:results }));
if (!verified) process.exitCode = 1;
