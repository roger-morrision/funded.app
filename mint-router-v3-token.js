import { Buffer } from 'buffer';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { deriveFeeRouter } from './fee-router.js';
import { deriveMintRouterV3, deriveMintPolicyV3, deriveMintVaultsV3 } from './mint-router-v3.js';

// Creator fees paid in a coin's paired token (USDC, an xStock, ...). Encodes the
// router's token instructions; their Anchor discriminators are checked in tests.
const DISCRIMINATORS = Object.freeze({
  initialize_token_ledger_v3: '55ad795e42d8ccd4',
  settle_mint_token_v3: '7e726b06ea0252de',
  approve_protected_token_withdrawal_v3: '5d9bfae623a74a85',
  disburse_protected_mint_token_v3: 'ccdc558df80147d1',
  MintTokenLedgerV3: 'f24bd61b10120020',
  convert_token_budget_v3: '647795a88d096dab',
  MintSolCreditV3: '7f45143efe67c0a9',
});
const seed = text => Buffer.from(text);
const key = value => new PublicKey(value);
const meta = (pubkey, isSigner = false, isWritable = false) => ({ pubkey: key(pubkey), isSigner, isWritable });
const u64 = value => { const out = Buffer.alloc(8); out.writeBigUInt64LE(BigInt(value)); return out; };

export const tokenDiscriminators = DISCRIMINATORS;

// Agency launches (all new launches) use the agency policy and eight category
// vaults (the eighth is the AI-agency budget); older launches use the protected
// policy and seven.
export function deriveAgencyPolicyV3(programId, mint) {
  return PublicKey.findProgramAddressSync([seed('mint-agency-policy-v3'), key(mint).toBuffer()], key(programId))[0];
}
const policyAddress = (programId, mint, agency) => agency ? deriveAgencyPolicyV3(programId, mint) : deriveMintPolicyV3(programId, mint).address;

export function deriveTokenLedgerV3(programId, mint, quoteMint) {
  return PublicKey.findProgramAddressSync([seed('mint-token-ledger-v3'), key(mint).toBuffer(), key(quoteMint).toBuffer()], key(programId))[0];
}
const deriveWithId = (label, programId, mint, quoteMint, id) =>
  PublicKey.findProgramAddressSync([seed(label), key(mint).toBuffer(), key(quoteMint).toBuffer(), Buffer.from(id)], key(programId))[0];
export const deriveTokenClaimV3 = (programId, mint, quoteMint, claimId) => deriveWithId('mint-token-claim-v3', programId, mint, quoteMint, claimId);
export const deriveTokenApprovalV3 = (programId, mint, quoteMint, id) => deriveWithId('mint-token-approval-v3', programId, mint, quoteMint, id);
export const deriveTokenWithdrawalV3 = (programId, mint, quoteMint, id) => deriveWithId('mint-token-withdraw-v3', programId, mint, quoteMint, id);

/** Token accounts of the coin's router and its seven category vaults for the paired token. */
export function deriveTokenAccountsV3(programId, mint, quoteMint, tokenProgram) {
  const router = deriveMintRouterV3(programId, mint).address;
  const vaults = [...deriveMintVaultsV3(programId, mint), PublicKey.findProgramAddressSync(
    [seed('mint-fee-vault-v3'), key(mint).toBuffer(), Buffer.from([7])], key(programId))[0]];
  const ata = owner => getAssociatedTokenAddressSync(key(quoteMint), owner, true, key(tokenProgram));
  return { router, routerToken: ata(router), vaults, vaultTokens: vaults.map(ata) };
}

/** Idempotent creation of the router's and vaults' paired-token accounts (payer pays rent). */
export function buildTokenAccountSetupInstructions({ programId, mint, quoteMint, tokenProgram, payer }) {
  const { router, routerToken, vaults, vaultTokens } = deriveTokenAccountsV3(programId, mint, quoteMint, tokenProgram);
  return [[routerToken, router], ...vaultTokens.map((account, index) => [account, vaults[index]])]
    .map(([account, owner]) => createAssociatedTokenAccountIdempotentInstruction(key(payer), account, owner, key(quoteMint), key(tokenProgram)));
}

export function buildTokenLedgerInitializeInstruction({ programId, mint, quoteMint, authority, agency = true }) {
  return new TransactionInstruction({ programId: key(programId), data: Buffer.from(DISCRIMINATORS.initialize_token_ledger_v3, 'hex'), keys: [
    meta(authority, true, true), meta(mint), meta(quoteMint), meta(deriveFeeRouter(programId).address),
    meta(policyAddress(programId, mint, agency)), meta(deriveTokenLedgerV3(programId, mint, quoteMint), false, true),
    meta(SystemProgram.programId),
  ] });
}

export function buildTokenSettlementInstruction({ programId, mint, quoteMint, tokenProgram, authority, claimId, amount, agency = true }) {
  const accounts = deriveTokenAccountsV3(programId, mint, quoteMint, tokenProgram);
  const data = Buffer.concat([Buffer.from(DISCRIMINATORS.settle_mint_token_v3, 'hex'), Buffer.from(claimId), u64(amount)]);
  return new TransactionInstruction({ programId: key(programId), data, keys: [
    meta(authority, true, true), meta(mint), meta(quoteMint), meta(deriveFeeRouter(programId).address),
    meta(policyAddress(programId, mint, agency)), meta(deriveTokenLedgerV3(programId, mint, quoteMint), false, true),
    meta(accounts.router), meta(accounts.routerToken, false, true),
    meta(deriveTokenClaimV3(programId, mint, quoteMint, claimId), false, true),
    meta(tokenProgram), meta(SystemProgram.programId),
    ...accounts.vaultTokens.slice(0, agency ? 8 : 7).map(account => meta(account, false, true)),
  ] });
}

export function buildTokenApprovalInstruction({ programId, mint, quoteMint, authority, creator, recipient, withdrawalId, category, beneficiary, amount, agency = true }) {
  const data = Buffer.concat([Buffer.from(DISCRIMINATORS.approve_protected_token_withdrawal_v3, 'hex'), Buffer.from(withdrawalId),
    Buffer.from([category, beneficiary]), u64(amount)]);
  return new TransactionInstruction({ programId: key(programId), data, keys: [
    meta(authority, true, true), meta(creator, true), meta(mint), meta(quoteMint), meta(deriveFeeRouter(programId).address),
    meta(policyAddress(programId, mint, agency)), meta(recipient),
    meta(deriveTokenApprovalV3(programId, mint, quoteMint, withdrawalId), false, true), meta(SystemProgram.programId),
  ] });
}

export function buildTokenDisbursementInstruction({ programId, mint, quoteMint, tokenProgram, authority, creator, creatorSigns = undefined,
  recipientOwner, withdrawalId, category, beneficiary, amount, holderAmount = 0n, agency = true, automation = false }) {
  const accounts = deriveTokenAccountsV3(programId, mint, quoteMint, tokenProgram);
  const recipientToken = getAssociatedTokenAddressSync(key(quoteMint), key(recipientOwner), true, key(tokenProgram));
  const data = Buffer.concat([Buffer.from(DISCRIMINATORS.disburse_protected_mint_token_v3, 'hex'), Buffer.from(withdrawalId),
    Buffer.from([category, beneficiary]), u64(amount), u64(holderAmount)]);
  return new TransactionInstruction({ programId: key(programId), data, keys: [
    meta(authority, true, true), meta(creator, creatorSigns ?? !automation), meta(mint), meta(quoteMint), meta(deriveFeeRouter(programId).address),
    meta(policyAddress(programId, mint, agency)), meta(deriveTokenLedgerV3(programId, mint, quoteMint), false, true),
    meta(accounts.vaults[category]), meta(accounts.vaultTokens[category], false, true),
    meta(recipientOwner), meta(recipientToken, false, true),
    meta(deriveTokenApprovalV3(programId, mint, quoteMint, withdrawalId), false, true),
    meta(deriveTokenWithdrawalV3(programId, mint, quoteMint, withdrawalId), false, true),
    meta(tokenProgram), meta(SystemProgram.programId),
    // Automatic payouts: the coin's immutable automation record stands in for the creator's signature.
    ...(automation ? [meta(PublicKey.findProgramAddressSync([seed('mint-automation-v3'), key(mint).toBuffer()], key(programId))[0])] : []),
  ] });
}

/** Decodes a MintTokenLedgerV3 account. */
export function decodeTokenLedgerV3(data) {
  const bytes = Buffer.from(data);
  if (bytes.length < 8 + 32 + 32 + 8 + 64 + 64 + 24 + 1 || bytes.subarray(0, 8).toString('hex') !== DISCRIMINATORS.MintTokenLedgerV3) throw new Error('Not a token ledger account.');
  const read = (offset, count) => Array.from({ length: count }, (_, index) => bytes.readBigUInt64LE(offset + index * 8));
  return { mint: new PublicKey(bytes.subarray(8, 40)).toBase58(), quoteMint: new PublicKey(bytes.subarray(40, 72)).toBase58(),
    settled: bytes.readBigUInt64LE(72), paid: read(80, 8), withdrawn: read(144, 8), released: read(208, 3), bump: bytes[232] };
}

const NATIVE = new PublicKey('So11111111111111111111111111111111111111112');
const SPL_TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const PUMP_SWAP = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');

export const deriveSolCreditV3 = (programId, mint) =>
  PublicKey.findProgramAddressSync([seed('mint-sol-credit-v3'), key(mint).toBuffer()], key(programId))[0];
export const deriveTokenConversionV3 = (programId, mint, conversionId) =>
  PublicKey.findProgramAddressSync([seed('mint-token-convert-v3'), key(mint).toBuffer(), Buffer.from(conversionId)], key(programId))[0];

/** SOL credited per category by paired-token conversions (all zero when the record is absent). */
export function decodeSolCreditV3(data) {
  const raw = Buffer.from(data || []);
  if (raw.length < 8 + 32 + 64 + 1 || raw.subarray(0, 8).toString('hex') !== DISCRIMINATORS.MintSolCreditV3) throw new Error('Invalid SOL credit record.');
  return { mint: new PublicKey(raw.subarray(8, 40)).toBase58(), credited: Array.from({ length: 8 }, (_, i) => raw.readBigUInt64LE(40 + i * 8)) };
}

/**
 * Converts part of a paired coin's buyback (6) or AI-agency (7) token budget to
 * SOL through the router's pinned PumpSwap WSOL/<token> pool. `pumpBuyInstruction`
 * is the SDK's PumpSwap buy for that pool with the category vault as user; its
 * accounts become the router's CPI accounts.
 */
export function buildTokenConversionInstruction({ programId, mint, quoteMint, quoteTokenProgram, authority, conversionId, category, amountIn, minSolOut, pumpBuyInstruction }) {
  if (![6, 7].includes(Number(category))) throw new Error('Only buyback (6) and AI-agency (7) budgets convert to SOL.');
  if (Buffer.from(conversionId || []).length !== 32) throw new Error('A 32-byte conversion ID is required.');
  if (!pumpBuyInstruction?.programId?.equals(PUMP_SWAP)) throw new Error('A PumpSwap buy instruction is required.');
  const program = key(programId), coin = key(mint), quote = key(quoteMint), quoteProgram = key(quoteTokenProgram);
  const vault = PublicKey.findProgramAddressSync([seed('mint-fee-vault-v3'), coin.toBuffer(), Buffer.from([Number(category)])], program)[0];
  const ata = (owner, tokenMint, tokenProgram) => getAssociatedTokenAddressSync(tokenMint, owner, true, tokenProgram);
  const keys = [
    meta(authority, true, true), meta(coin), meta(quote), meta(deriveFeeRouter(program).address),
    meta(deriveAgencyPolicyV3(program, coin), false, true), meta(deriveTokenLedgerV3(program, coin, quote), false, true),
    meta(vault, false, true), meta(ata(vault, quote, quoteProgram), false, true), meta(ata(vault, NATIVE, SPL_TOKEN), false, true),
    meta(deriveSolCreditV3(program, coin), false, true), meta(deriveTokenConversionV3(program, coin, conversionId), false, true),
    meta(SPL_TOKEN), meta(quoteProgram), meta(ATA_PROGRAM), meta(PUMP_SWAP), meta(SystemProgram.programId),
    ...pumpBuyInstruction.keys.map((row, index) => ({ pubkey: row.pubkey, isSigner: false, isWritable: index === 1 ? true : row.isWritable })),
  ];
  const data = Buffer.concat([Buffer.from(DISCRIMINATORS.convert_token_budget_v3, 'hex'), Buffer.from(conversionId), Buffer.from([Number(category)]), u64(amountIn), u64(minSolOut)]);
  return { instruction: new TransactionInstruction({ programId: program, keys, data }), vault };
}
