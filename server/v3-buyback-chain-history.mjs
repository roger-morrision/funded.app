import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import { PUMP_AMM_PROGRAM_ID } from '@pump-fun/pump-swap-sdk';
import { deriveMintPolicyV3 } from '../mint-router-v3.js';
import { loadFinalizedV3Buyback } from './v3-buyback-proof.mjs';

const receiptDiscriminator = createHash('sha256').update('account:MintBuybackV3').digest().subarray(0, 8);
const policyDiscriminator = Buffer.from('25d0c7eca736c38f', 'hex');
const instructionDiscriminator = createHash('sha256').update('global:buyback_mint_v3').digest().subarray(0, 8);
const pumpBuyDiscriminator = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);

// This is display-only discovery. A cleared application ledger cannot use an
// old receipt to authorize an automatic buyback or reduce a new fee budget.
export async function latestUnindexedV3Burn({ connection, programId,
  indexedSignatures = new Set(), verifyBurn = loadFinalizedV3Buyback }) {
  if (typeof connection.getProgramAccounts !== 'function'
    || typeof connection.getSignaturesForAddress !== 'function') return null;
  const program = new PublicKey(programId);
  const accounts = await connection.getProgramAccounts(program, {
    commitment:'finalized', filters:[{ dataSize:160 }],
  });
  const candidates = accounts.flatMap(({ pubkey, account }) => {
    const data = Buffer.from(account.data || []);
    if (!account.owner?.equals(program) || data.length !== 160
      || !data.subarray(0, 8).equals(receiptDiscriminator)) return [];
    const mint = new PublicKey(data.subarray(40, 72));
    const id = data.subarray(8, 40);
    const expected = PublicKey.findProgramAddressSync([
      Buffer.from('mint-buyback-v3'), mint.toBuffer(), id,
    ], program)[0];
    if (!pubkey.equals(expected)) return [];
    return [{ pubkey, mint, id, createdAt:data.readBigInt64LE(152) }];
  }).sort((a, b) => a.createdAt === b.createdAt ? 0 : a.createdAt > b.createdAt ? -1 : 1);
  // Refuse an unbounded chain scan on a public page. Existing app receipts
  // remain available even when the display-only history is too large.
  if (candidates.length > 100) return null;
  for (const candidate of candidates) {
    const { pubkey, mint, id } = candidate;
    const policyAddress = deriveMintPolicyV3(program, mint).address;
    const [policyAccount, signatures] = await Promise.all([
      connection.getAccountInfo(policyAddress, 'finalized'),
      connection.getSignaturesForAddress(pubkey, { limit:3 }, 'finalized'),
    ]);
    const policy = Buffer.from(policyAccount?.data || []);
    if (!policyAccount?.owner?.equals(program) || policy.length !== 249
      || !policy.subarray(0, 8).equals(policyDiscriminator)
      || !policy.subarray(8, 40).equals(mint.toBuffer())) continue;
    const creator = new PublicKey(policy.subarray(40, 72));
    const initialAuthority = new PublicKey(policy.subarray(72, 104));
    for (const row of signatures || []) {
      if (row.err || row.confirmationStatus !== 'finalized'
        || indexedSignatures.has(row.signature)) continue;
      const tx = await connection.getTransaction(row.signature, {
        commitment:'finalized', maxSupportedTransactionVersion:0,
      });
      if (!tx || tx.meta?.err !== null) continue;
      const message = tx.transaction?.message;
      const keys = [...(message?.accountKeys || message?.staticAccountKeys || []),
        ...(tx.meta.loadedAddresses?.writable || []),
        ...(tx.meta.loadedAddresses?.readonly || [])].map(key => new PublicKey(key));
      for (const ix of message?.instructions || message?.compiledInstructions || []) {
        if (!keys[ix.programIdIndex]?.equals(program)) continue;
        const data = typeof ix.data === 'string'
          ? Buffer.from(bs58.decode(ix.data)) : Buffer.from(ix.data || []);
        const indices = ix.accounts || ix.accountKeyIndexes || [];
        const accounts = indices.map(index => keys[index]);
        if (data.length !== 64 || !data.subarray(0, 8).equals(instructionDiscriminator)
          || !data.subarray(8, 40).equals(id) || accounts.length < 41
          || !accounts[1]?.equals(creator) || !accounts[2]?.equals(mint)
          || !accounts[10]?.equals(pubkey)) continue;
        const pumpBuyInstruction = { programId:PUMP_AMM_PROGRAM_ID,
          data:pumpBuyDiscriminator,
          keys:accounts.slice(16).map(key => ({ pubkey:key, isSigner:false, isWritable:false })) };
        const proof = await verifyBurn({ connection, signature:row.signature,
          programId:program, sourceMint:mint, creator, initialAuthority,
          authority:accounts[0], baseTokenProgram:accounts[11], buybackId:id,
          spendableQuoteIn:data.readBigUInt64LE(40),
          minBaseAmountOut:data.readBigUInt64LE(48),
          maxTotalDebit:data.readBigUInt64LE(56), pumpBuyInstruction, split:null });
        if (proof?.finalized && proof.receipt === pubkey.toBase58())
          return { ...proof, source:'onchain-unindexed' };
      }
    }
  }
  return null;
}
