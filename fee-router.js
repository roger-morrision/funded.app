import { PublicKey } from '@solana/web3.js';

export const FEE_ROUTER_SEED = 'funded-fee-router-v1';
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

export function buildFeeRouterPolicy({ programId, address, bump } = {}) {
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
      seed: FEE_ROUTER_SEED,
      programId: programId ? String(programId) : null,
      bump: Number.isInteger(bump) ? bump : null,
      accountMagic: FEE_ROUTER_ACCOUNT_MAGIC,
      version: FEE_ROUTER_VERSION,
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
