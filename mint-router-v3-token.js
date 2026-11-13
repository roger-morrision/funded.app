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
