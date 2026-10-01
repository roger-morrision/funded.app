import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { communityProgramReserveAddress, DEVNET_GENESIS_HASH, readProgramDataEvidence } from '../server/automatic-reward-chain.mjs';
import { communityReserveClaimId, deriveMintClaim, readMintClaimRecord } from '../server/mint-router-payout.mjs';

for (const [name, path] of Object.entries(process.env)) {
  if (name.endsWith('_FILE') && path && process.env[name.slice(0, -5)] == null) {
    process.env[name.slice(0, -5)] = readFileSync(path, 'utf8').trim();
  }
}

assert.equal(process.env.SOLANA_CLUSTER, 'devnet', 'This verifier is Devnet only.');
const rpc = process.env.SOLANA_DEVNET_RPC_URL || process.env.SOLANA_RPC_URL;
const ledgerPath = process.env.AUTOMATIC_REWARD_STORE_PATH;
assert(rpc && ledgerPath, 'Explicit Devnet RPC and reward ledger paths are required.');
const secret = process.env.FUNDED_ROUTER_AUTHORITY_SECRET_KEY;
assert(secret, 'The configured router authority is required to identify the vault.');
const authority = Keypair.fromSecretKey(bs58.decode(secret)).publicKey;
const program = new PublicKey(process.env.FUNDED_FEE_ROUTER_PROGRAM_ID);
const connection = new Connection(rpc, 'finalized');
assert.equal(await connection.getGenesisHash(), DEVNET_GENESIS_HASH, 'The RPC is not Solana Devnet.');
const programEvidence = await readProgramDataEvidence(connection, program);
assert.equal(programEvidence.sha256, String(process.env.FUNDED_REWARD_PROGRAM_DATA_SHA256 || '').toLowerCase(), 'The deployed program does not match the approved hash.');

const vault = communityProgramReserveAddress({ programId:program, authority });
const account = await connection.getAccountInfo(vault, 'finalized');
assert(account?.owner?.equals(program), 'The community reserve vault is missing or has the wrong owner.');
const data = Buffer.from(account.data);
const discriminator = createHash('sha256').update('account:RewardVault').digest().subarray(0, 8);
assert(data.length === 73 && data.subarray(0, 8).equals(discriminator)
  && data.subarray(8, 40).equals(authority.toBuffer())
  && data.subarray(40, 72).equals(program.toBuffer()), 'The community reserve vault header is invalid.');

const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
const requests = Object.values(ledger.fundingRequests || {}).filter(row => row.kind === 'community-reserve' && row.status === 'funded');
assert(requests.length > 0, 'No funded community reserve requests exist.');
let totalLamports = 0n;
for (const row of requests) {
  assert(row.asset === 'SOL' && row.recipient == null && row.balanceDeltaVerified === true
    && row.vault === vault.toBase58() && row.sourceSignature && row.id === `${row.sourceSignature}:community`, 'A reserve ledger entry is inconsistent.');
  const amount = BigInt(row.amount);
  assert(amount > 0n, 'A reserve amount must be positive.');
  const claimId = communityReserveClaimId(row.id);
  const claim = deriveMintClaim(program, row.mint, claimId);
  assert.equal(row.fundingClaim, claim.toBase58(), 'The reserve claim address differs from the on-chain PDA.');
  const record = await connection.getAccountInfo(claim, 'finalized');
  assert(readMintClaimRecord(record, { programId:program, mint:row.mint, recipient:vault,
    amountLamports:row.amount, claimId }), 'The on-chain reserve claim record does not match the exact transfer.');
  if (row.fundingSignature) {
    const status = (await connection.getSignatureStatuses([row.fundingSignature], { searchTransactionHistory:true })).value?.[0];
    assert(status?.confirmationStatus === 'finalized' && !status.err, 'A reserve funding transaction is not finalized.');
  }
  totalLamports += amount;
}
const rent = BigInt(await connection.getMinimumBalanceForRentExemption(data.length, 'finalized'));
assert(BigInt(account.lamports) >= rent + totalLamports, 'The current on-chain vault balance does not cover verified reserve transfers.');
console.log(JSON.stringify({ cluster:'devnet', status:'verified', vault:vault.toBase58(),
  fundedClaims:requests.length, verifiedFundingLamports:String(totalLamports),
  currentVaultLamports:String(account.lamports), rentLamports:String(rent) }));
