import { PublicKey } from '@solana/web3.js';

export const FEE_ROUTER_SEED = 'funded-fee-router-v1';
export const MINT_FEE_ROUTER_SEED = 'funded-mint-router-v2';
export const MINT_FEE_ROUTER_MAGIC = 'FUNDMNT2';
export const MINT_FEE_ROUTER_VERSION = 2;
export const MINT_FEE_ROUTER_DATA_LEN = 106;
export const FEE_ROUTER_ACCOUNT_MAGIC = 'FUNDFEE1';
export const FEE_ROUTER_VERSION = 1;
export const FEE_ROUTER_POLICY_ID = 'funded-creator-fees-100-in-80-20-out-v1';
export const FEE_ROUTER_POLICY_HASH_HEX = '0e057c44e5e3e33772e539c994cf73ed44c69ba7a8f57ba23fffa1c10b890e8b';

const expectedPrefix = Uint8Array.from([
  ...new TextEncoder().encode(FEE_ROUTER_ACCOUNT_MAGIC),
  FEE_ROUTER_VERSION,
  ...FEE_ROUTER_POLICY_HASH_HEX.match(/.{2}/g).map(byte => Number.parseInt(byte, 16)),
]);

export function buildExpectedFeeRouterAccountPrefix() {
  return Uint8Array.from(expectedPrefix);
}

export function deriveFeeRouter(programId) {
  const program = new PublicKey(String(programId || '').trim());
  const [address, bump] = PublicKey.findProgramAddressSync([new TextEncoder().encode(FEE_ROUTER_SEED)], program);
  return { programId: program, address, bump };
}

export function deriveMintFeeRouter(programId, mint) {
  const program = new PublicKey(String(programId || '').trim());
  const mintAddress = new PublicKey(String(mint || '').trim());
  const [address, bump] = PublicKey.findProgramAddressSync([new TextEncoder().encode(MINT_FEE_ROUTER_SEED), mintAddress.toBuffer()], program);
  return { programId: program, mint: mintAddress, address, bump };
}

export async function verifyMintFeeRouterAccount({ connection, programId, mint, expectedAuthority = null }) {
  const router = deriveMintFeeRouter(programId, mint);
  const account = await connection.getAccountInfo(router.address, 'confirmed');
  if (!account) return { ...router, verified: false, reason: 'mint-router-account-not-deployed' };
  if (!account.owner.equals(router.programId)) return { ...router, verified: false, reason: 'mint-router-owner-mismatch' };
  const data = Uint8Array.from(account.data || []);
  const magic = new TextEncoder().encode(MINT_FEE_ROUTER_MAGIC);
  const policyHash = Uint8Array.from(FEE_ROUTER_POLICY_HASH_HEX.match(/.{2}/g).map(byte => Number.parseInt(byte, 16)));
  const mintBytes = router.mint.toBytes();
  const valid = data.length === MINT_FEE_ROUTER_DATA_LEN
    && magic.every((byte, index) => data[index] === byte)
    && data[8] === MINT_FEE_ROUTER_VERSION
    && policyHash.every((byte, index) => data[9 + index] === byte)
    && mintBytes.every((byte, index) => data[73 + index] === byte)
    && data[105] === router.bump;
  if (!valid) return { ...router, verified: false, reason: 'mint-router-policy-layout-mismatch' };
  const authority = new PublicKey(data.slice(41, 73));
  if (expectedAuthority && !authority.equals(new PublicKey(expectedAuthority))) return { ...router, authority, verified: false, reason: 'mint-router-authority-mismatch' };
  return { ...router, authority, verified: true, reason: 'verified' };
}

export async function verifyFeeRouterAccount({ connection, programId }) {
  const router = deriveFeeRouter(programId);
  const account = await connection.getAccountInfo(router.address, 'confirmed');
  if (!account) return { ...router, verified: false, reason: 'router-account-not-deployed' };
  if (!account.owner.equals(router.programId)) return { ...router, verified: false, reason: 'router-owner-mismatch' };
  const data = Uint8Array.from(account.data || []);
  if (data.length < expectedPrefix.length || expectedPrefix.some((byte, index) => data[index] !== byte)) {
    return { ...router, verified: false, reason: 'router-policy-layout-mismatch' };
  }
  return { ...router, verified: true, reason: 'verified' };
}

export function buildFeeRouterPolicy({ programId, address, bump, scope = 'shared-legacy', mint = null } = {}) {
  const perMint = scope === 'per-mint-v2';
  return {
    chain: 'solana',
    ingress: {
      source: 'pump-create-v2-creator-address',
      percent: 100,
      shareBps: 10_000,
      recipient: address ? String(address) : null,
    },
    router: {
      type: 'program-derived-address',
      seed: perMint ? MINT_FEE_ROUTER_SEED : FEE_ROUTER_SEED,
      ...(perMint ? { mint: mint?.toBase58?.() || String(mint) } : {}),
      programId: programId ? String(programId) : null,
      bump: Number.isInteger(bump) ? bump : null,
      accountMagic: perMint ? MINT_FEE_ROUTER_MAGIC : FEE_ROUTER_ACCOUNT_MAGIC,
      version: perMint ? MINT_FEE_ROUTER_VERSION : FEE_ROUTER_VERSION,
      policyId: FEE_ROUTER_POLICY_ID,
      policyHash: FEE_ROUTER_POLICY_HASH_HEX,
    },
    lock: {
      required: true,
      pumpCreatorAtCreation: 'funded-app-fee-router-pda',
      userHasCreatorFeeAuthority: false,
      activationGate: 'bonding-curve-creator-equals-router-and-does-not-equal-payer',
    },
    settlement: {
      trigger: 'successful-fee-claim',
      idempotencyKey: 'claim-transaction-signature',
      rule: 'allocate-100-percent-before-payout',
      retry: 'failed-payouts-remain-pending-to-original-recipient',
    },
  };
}
