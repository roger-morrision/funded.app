import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import { buildMintRouterV3SettlementInstruction, deriveMintPolicyV3,
  verifyMintPolicyV3Account, protocolGrossUnits } from '../mint-router-v3.js';

const address = value => typeof value === 'string' ? value : value?.pubkey
  ? address(value.pubkey) : value?.toBase58?.() || '';
const discriminator = name => createHash('sha256').update(`global:${name}`).digest().subarray(0,8).toString('hex');
const settle = discriminator('settle_mint_v3');
const unchanged = new Set(['disburse_mint_v3','approve_protected_withdrawal_v3',
  'disburse_protected_mint_v3','buyback_mint_v3'].map(discriminator));
const targets = (total, split) => {
  let prefix = 0n, previous = 0n;
  return [8_000_000, ...protocolGrossUnits(split)].map(units => {
    prefix += BigInt(units); const end = total * prefix / 10_000_000n;
    const amount = end - previous; previous = end; return amount;
  });
};

// Recover an immutable settlement's cumulative position from a context-bound
// finalized policy snapshot. Same-slot order comes from the finalized block,
// never from the RPC's ordering of address-history results.
export async function loadV3SettlementPosition({ connection, signature, slot, programId,
  mint, authority, creator, expectedLamports, categoryLamports, split,
  verifyPolicy = verifyMintPolicyV3Account }) {
  const policyAddress = deriveMintPolicyV3(programId,mint).address;
  const snapshot = await connection.getAccountInfoAndContext(policyAddress,{commitment:'finalized'});
  if (!snapshot?.value || !Number.isSafeInteger(snapshot.context?.slot) || snapshot.context.slot < slot)
    throw new Error('Finalized V3 policy snapshot is unavailable.');
  const policy = await verifyPolicy({ connection:{getAccountInfo:async()=>snapshot.value},
    programId,mint,creator,initialAuthority:authority,split });
  if (!policy.verified) throw new Error('Finalized V3 policy snapshot is invalid.');
  const block = await connection.getBlockSignatures(slot,'finalized');
  const order = block?.signatures;
  if (!Array.isArray(order) || order.filter(value=>value===signature).length !== 1)
    throw new Error('Finalized settlement block order is unavailable.');
  const targetIndex = order.indexOf(signature);
  let before, previousSlot = Number.MAX_SAFE_INTEGER, later = 0n, found = false, done = false;
  const seen = new Set();
  while (!done) {
    const refs = await connection.getSignaturesForAddress(policyAddress,{limit:1000,...(before?{before}:{})},'finalized');
    if (!Array.isArray(refs) || refs.length > 1000) throw new Error('Invalid finalized policy history.');
    for (const ref of refs) {
      if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(ref.signature || '') || seen.has(ref.signature)
        || ref.confirmationStatus !== 'finalized' || !Number.isSafeInteger(ref.slot) || ref.slot < 1 || ref.slot > previousSlot)
        throw new Error('Finalized policy history has an ordering or finality gap.');
      seen.add(ref.signature); previousSlot = ref.slot;
      if (ref.slot < slot) { done = true; break; }
      if (ref.signature === signature) { if(ref.err)throw new Error('Settlement failed.'); found = true; continue; }
      if (ref.slot > snapshot.context.slot || ref.err) continue;
      if (ref.slot === slot) {
        const index = order.indexOf(ref.signature);
        if (index < 0) throw new Error('Policy history disagrees with its finalized block.');
        if (index < targetIndex) continue;
      }
      const tx = await connection.getTransaction(ref.signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
      if (!tx || tx.slot !== ref.slot || tx.meta?.err !== null || tx.transaction?.signatures?.[0] !== ref.signature)
        throw new Error('Finalized later settlement history is unavailable.');
      const message = tx.transaction.message;
      const keys = [...(message.accountKeys || message.staticAccountKeys || []).map(address),
        ...(tx.meta.loadedAddresses?.writable || []).map(address),...(tx.meta.loadedAddresses?.readonly || []).map(address)];
      const instructions = [...(message.instructions || message.compiledInstructions || []),
        ...(tx.meta.innerInstructions || []).flatMap(row=>row.instructions)];
      for (const instruction of instructions) {
        if (keys[instruction.programIdIndex] !== new PublicKey(programId).toBase58()) continue;
        const accounts = (instruction.accounts || instruction.accountKeyIndexes || []).map(index=>keys[index]);
        if (!accounts.includes(policyAddress.toBase58())) continue;
        const data = Buffer.from(typeof instruction.data === 'string' ? bs58.decode(instruction.data) : instruction.data || []);
        const code = data.subarray(0,8).toString('hex');
        if (unchanged.has(code)) continue;
        if (code !== settle || data.length !== 48) throw new Error('Unknown V3 policy mutation requires reconciliation.');
        const amount = data.readBigUInt64LE(40);
        const expected = buildMintRouterV3SettlementInstruction({programId,mint,authority,creator,
          claimId:data.subarray(8,40),expectedLamports:amount}).instruction;
        if (accounts.length !== expected.keys.length || expected.keys.some((key,index)=>key.pubkey.toBase58() !== accounts[index]))
          throw new Error('Later V3 settlement does not match the immutable policy.');
        later += amount;
      }
    }
    if (done || refs.length < 1000) break;
    before = refs.at(-1).signature;
  }
  if (!found) throw new Error('The settlement is missing from finalized policy history.');
  const after = policy.settledLamports - later, prior = after - BigInt(expectedLamports);
  if (prior < 0n) throw new Error('Finalized V3 settlement totals do not reconcile.');
  const low = targets(prior,split), high = targets(after,split);
  if (high.some((value,index)=>String(value-low[index]) !== String(categoryLamports[index])))
    throw new Error('Finalized V3 category deltas disagree with cumulative totals.');
  return { settledBeforeLamports:String(prior), settledAfterLamports:String(after),
    creatorPoolBeforeLamports:String(low[0]), creatorPoolAfterLamports:String(high[0]),
    policySettledLamports:String(policy.settledLamports) };
}
