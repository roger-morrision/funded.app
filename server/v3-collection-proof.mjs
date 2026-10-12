import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PUMP_PROGRAM_ID, PUMP_AMM_PROGRAM_ID, creatorVaultPda, getPumpProgram } from '@pump-fun/pump-sdk';
import { PUMP_AMM_SDK } from '@pump-fun/pump-swap-sdk';
import { ComputeBudgetProgram, PublicKey } from '@solana/web3.js';
import { deriveMintRouterV3 } from '../mint-router-v3.js';

const address = value => typeof value === 'string' ? value : value?.pubkey ? address(value.pubkey) : value?.toBase58?.() || '';

// The caller must fetch `transaction` from RPC with commitment: 'finalized'.
// The launch verifier must independently bind the mint's Pump creator to this
// router. This proof excludes other outer programs and checks the exact router
// delta; it cannot turn an arbitrary ledger row into an on-chain claim.
export async function verifyV3PumpCollection({ transaction, signature, programId, mint, expectedLamports = null }) {
  try {
    if (!transaction || transaction.meta?.err !== null || !Number.isSafeInteger(transaction.slot)
      || transaction.slot <= 0 || !transaction.transaction?.signatures?.includes(signature)) return null;
    const router = deriveMintRouterV3(programId, mint).address;
    const expectedCollect = await getPumpProgram(null).methods.collectCreatorFeeV2()
      .accountsPartial({ creator:router, quoteMint:NATIVE_MINT, quoteTokenProgram:TOKEN_PROGRAM_ID,
        creatorVault:creatorVaultPda(router) }).instruction();
    const message = transaction.transaction.message;
    const keys = [ ...(message.accountKeys || message.staticAccountKeys || []),
      ...(transaction.meta.loadedAddresses?.writable || []),
      ...(transaction.meta.loadedAddresses?.readonly || []) ].map(address);
    const index = value => keys.indexOf(address(value));
    const routerIndex = index(router);
    const nativeIndex = index(NATIVE_MINT);
    const tokenProgramIndex = index(TOKEN_PROGRAM_ID);
    const vaultIndex = index(creatorVaultPda(router));
    const pre = transaction.meta.preBalances, post = transaction.meta.postBalances;
    if ([routerIndex, nativeIndex, tokenProgramIndex, vaultIndex].some(value => value < 0)
      || !Array.isArray(pre) || !Array.isArray(post) || pre.length !== keys.length || post.length !== keys.length
      || !Number.isSafeInteger(pre[routerIndex]) || !Number.isSafeInteger(post[routerIndex])) return null;
    const lamports = post[routerIndex] - pre[routerIndex];
    if (!Number.isSafeInteger(lamports) || lamports <= 0
      || (expectedLamports != null && BigInt(expectedLamports) !== BigInt(lamports))) return null;
    const instructions = message.instructions || message.compiledInstructions || [];
    let collectCount = 0;
    let ammTransferCount = 0;
    for (const instruction of instructions) {
      const program = keys[instruction.programIdIndex];
      if (program !== PUMP_PROGRAM_ID.toBase58() && program !== PUMP_AMM_PROGRAM_ID.toBase58()
        && program !== ComputeBudgetProgram.programId.toBase58()) return null;
      const data = typeof instruction.data === 'string' ? bs58.decode(instruction.data) : Buffer.from(instruction.data || []);
      const accounts = instruction.accounts || instruction.accountKeyIndexes || [];
      if (program === ComputeBudgetProgram.programId.toBase58()) continue;
      if (program === PUMP_AMM_PROGRAM_ID.toBase58()) {
        if (ammTransferCount || collectCount || accounts.length === 0 || !keys[accounts[0]]) return null;
        const expected = await PUMP_AMM_SDK.transferCreatorFeesToPumpV2Instruction({
          payer:new PublicKey(keys[accounts[0]]), coinCreator:router,
          quoteMint:NATIVE_MINT, quoteTokenProgram:TOKEN_PROGRAM_ID,
        });
        if (!Buffer.from(data).equals(expected.data) || accounts.length !== expected.keys.length
          || expected.keys.some((key, index) => keys[accounts[index]] !== key.pubkey.toBase58())) return null;
        ammTransferCount++;
        continue;
      }
      if (!Buffer.from(data).equals(expectedCollect.data)
        || accounts.length !== expectedCollect.keys.length
        || expectedCollect.keys.some((key, index) => keys[accounts[index]] !== key.pubkey.toBase58())) return null;
      collectCount++;
    }
    if (collectCount !== 1) return null;
    const claimId = createHash('sha256').update('funded-v3-pump-collection:').update(signature).digest();
    return { mint:new PublicKey(mint).toBase58(), router:router.toBase58(), signature,
      claimId, expectedLamports:BigInt(lamports), slot:transaction.slot };
  } catch { return null; }
}
