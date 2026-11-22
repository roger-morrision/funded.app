import { ComputeBudgetProgram, Transaction, VersionedTransaction } from '@solana/web3.js';
import { verifyRewardBatch } from './reward-batch-proof.mjs';

export const REWARD_BATCH_LIMITS = Object.freeze({ recipients:4, bytes:1200, computeUnits:600_000 });

// Fit against the serialized wire transaction, including its signature. No lookup
// tables or unbounded input. A long Merkle proof can force a single-recipient tx.
export function rewardBatchTransaction(prepared, payer, blockhash, units = REWARD_BATCH_LIMITS.computeUnits) {
  if (!prepared.length || prepared.length > REWARD_BATCH_LIMITS.recipients
    || !Number.isSafeInteger(units) || units < 1 || units > REWARD_BATCH_LIMITS.computeUnits)
    throw new Error('Reward batch exceeds recipient or compute bounds.');
  const tx = new Transaction({ feePayer:payer, recentBlockhash:blockhash })
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units }), ...prepared.flatMap(row => row.transaction.instructions));
  if (tx.compileMessage().header.numRequiredSignatures !== 1
    || tx.serialize({ requireAllSignatures:false, verifySignatures:false }).length > REWARD_BATCH_LIMITS.bytes)
    throw new Error('Reward batch exceeds its wire-size or signer bound.');
  return tx;
}

export function createRewardBatchSubmitter({ cluster, connection, authority, prepareLeaf, inspectLeaf, submitLeaf, send,
  requireReady = async () => {}, verify = verifyRewardBatch }) {
  return async function submitLeaves(plan, leaves) {
    if (cluster !== 'devnet') throw new Error('Reward batching is enabled on Devnet only.');
    if (!Array.isArray(leaves) || !leaves.length || leaves.length > REWARD_BATCH_LIMITS.recipients
      || new Set(leaves.map(leaf => leaf.recipient)).size !== leaves.length)
      throw new Error('A bounded batch of distinct reward recipients is required.');
    // Shared by the bounded group, with another check in send() before each
    // transaction. Do not open a new program-evidence connection per recipient.
    await requireReady(plan);
    const outcomes = new Map(), prepared = [];
    for (const leaf of leaves) {
      try {
        const row = await prepareLeaf(plan, leaf);
        if (row.paid) outcomes.set(leaf.recipient, { leaf, result:row.paid });
        else {
          if (row.recipient.equals(authority.publicKey)) {
            if (!submitLeaf) throw new Error('Self-payment requires the single-recipient path.');
            outcomes.set(leaf.recipient, { leaf, result:await submitLeaf(plan, leaf) });
          } else prepared.push(row);
        }
      } catch (error) { outcomes.set(leaf.recipient, { leaf, error }); }
    }
    async function run(rows) {
      if (!rows.length) return;
      let transaction;
      // Split only before signing/submission. A failed/ambiguous send must be
      // reconciled through payment PDAs on a later pass, never blindly resent.
      try {
        const { blockhash } = await connection.getLatestBlockhash('finalized');
        transaction = rewardBatchTransaction(rows, authority.publicKey, blockhash);
        const simulated = await connection.simulateTransaction(new VersionedTransaction(transaction.compileMessage()),
          { sigVerify:false, replaceRecentBlockhash:true, commitment:'confirmed' });
        const units = simulated.value?.unitsConsumed;
        if (simulated.value?.err || !Number.isSafeInteger(units) || units <= 0
          || Math.ceil(units * 1.15) > REWARD_BATCH_LIMITS.computeUnits)
          throw new Error(`Reward batch simulation failed: ${JSON.stringify(simulated.value?.err || 'compute bound')}`);
        transaction = rewardBatchTransaction(rows, authority.publicKey, blockhash, Math.max(10_000, Math.ceil(units * 1.15)));
      } catch (error) {
        if (rows.length > 1) {
          const middle = Math.ceil(rows.length / 2);
          await run(rows.slice(0, middle)); await run(rows.slice(middle));
        } else outcomes.set(rows[0].leaf.recipient, { leaf:rows[0].leaf, error });
        return;
      }
      try {
        const signature = await send(transaction);
        await requireReady(plan);
        const results = await verify({ connection, authority:authority.publicKey, plan, rows, signature, inspectLeaf });
        rows.forEach((row, index) => outcomes.set(row.leaf.recipient, { leaf:row.leaf, result:results[index] }));
      } catch (error) { rows.forEach(row => outcomes.set(row.leaf.recipient, { leaf:row.leaf, error })); }
    }
    await run(prepared);
    return leaves.map(leaf => outcomes.get(leaf.recipient));
  };
}

// Manual requests supply selected schedule IDs and use submitLeaf immediately.
// Automatic callers recheck saved/paused state before every bounded group.
export async function* rewardPayoutGroups({ chain, plan, leaves, batch = true, store }) {
  const enabled = batch && chain.cluster === 'devnet' && typeof chain.submitLeaves === 'function';
  const width = enabled ? REWARD_BATCH_LIMITS.recipients : 1;
  for (let offset = 0; offset < leaves.length; offset += width) {
    const group = leaves.slice(offset, offset + width);
    yield { leaves:group, submit:() => enabled ? chain.submitLeaves(plan, group)
      : Promise.all(group.map(async leaf => {
        try { return { leaf, result:await chain.submitLeaf(plan, leaf,{store}) }; }
        catch (error) { return { leaf, error }; }
      })) };
  }
}
