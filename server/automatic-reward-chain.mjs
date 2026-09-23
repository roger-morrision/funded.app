import { createHash } from 'node:crypto';
import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { SOL_ASSET_MINT, verifyRewardProof } from '../reward-merkle.js';
import { buildMintRouterSettlementInstruction, readMintClaimRecord } from './mint-router-payout.mjs';

// Solana Devnet may be reset. Keep this value aligned with the current official
// Devnet RPC evidence and fail closed when the configured endpoint differs.
export const DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const REWARD_PROGRAM_VERSION = 'reward-manifest-v1';
const VAULT_SEED = Buffer.from('reward-vault-v1');
const CYCLE_SEED = Buffer.from('reward-cycle-v1');
const PAYMENT_SEED = Buffer.from('reward-payment-v1');
const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');

function discriminator(namespace, name) {
  return createHash('sha256').update(`${namespace}:${name}`).digest().subarray(0, 8);
}

function u64(value) { const out = Buffer.alloc(8); out.writeBigUInt64LE(BigInt(value)); return out; }
function i64(value) { const out = Buffer.alloc(8); out.writeBigInt64LE(BigInt(value)); return out; }
function u32(value) { const out = Buffer.alloc(4); out.writeUInt32LE(Number(value)); return out; }
function hex32(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/i.test(value)) throw new Error(`${label} must be 32-byte hex.`);
  return Buffer.from(value, 'hex');
}

export function rewardAddresses({ programId, authority, mint, cycleId, recipient }) {
  const program = new PublicKey(programId), authorityKey = new PublicKey(authority), mintKey = new PublicKey(mint);
  const [vault] = PublicKey.findProgramAddressSync([VAULT_SEED, authorityKey.toBuffer(), mintKey.toBuffer()], program);
  const result = { vault };
  if (cycleId) {
    const [cycle] = PublicKey.findProgramAddressSync([CYCLE_SEED, vault.toBuffer(), hex32(cycleId, 'cycleId')], program);
    result.cycle = cycle;
    if (recipient) [result.payment] = PublicKey.findProgramAddressSync([PAYMENT_SEED, cycle.toBuffer(), new PublicKey(recipient).toBuffer()], program);
  }
  return result;
}

function parseCycle(account) {
  const data = Buffer.from(account?.data || []);
  if (data.length < 173 || !data.subarray(0, 8).equals(discriminator('account', 'RewardCycle'))) return null;
  return {
    vault: new PublicKey(data.subarray(8, 40)).toBase58(),
    cycleId: data.subarray(40, 72).toString('hex'),
    root: data.subarray(72, 104).toString('hex'),
    asset: new PublicKey(data.subarray(104, 136)).toBase58() === SOL_ASSET_MINT ? 'SOL' : new PublicKey(data.subarray(104, 136)).toBase58(),
    totalAmount: String(data.readBigUInt64LE(136)),
    distributedAmount: String(data.readBigUInt64LE(144)),
    cutoffAt: Number(data.readBigInt64LE(152)), payoutAt: Number(data.readBigInt64LE(160)), leafCount: data.readUInt32LE(168),
  };
}

function parsePayment(account) {
  const data = Buffer.from(account?.data || []);
  if (data.length < 92 || !data.subarray(0, 8).equals(discriminator('account', 'RewardPayment'))) return null;
  return { cycle: new PublicKey(data.subarray(8, 40)).toBase58(), recipient: new PublicKey(data.subarray(40, 72)).toBase58(), amount: String(data.readBigUInt64LE(72)), leafIndex: data.readUInt32LE(80), paidAt: Number(data.readBigInt64LE(84)) };
}

async function finalizedSend(connection, transaction, signers) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const fresh = new Transaction().add(...transaction.instructions);
    if (transaction.feePayer) fresh.feePayer = transaction.feePayer;
    try {
      const signature = await sendAndConfirmTransaction(connection, fresh, signers, { commitment: 'finalized', preflightCommitment: 'confirmed' });
      const status = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
      if (!status?.value || status.value.err || status.value.confirmationStatus !== 'finalized') throw new Error('Reward transaction is not finalized successfully.');
      return signature;
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error);
      if (attempt === 2 || !/blockhash not found|429|too many requests/i.test(message)) throw error;
      await new Promise(resolveWait => setTimeout(resolveWait, 500 * (attempt + 1)));
    }
  }
  throw lastError;
}

export async function readProgramDataEvidence(connection, program) {
  const programKey = new PublicKey(program);
  const account = await connection.getAccountInfo(programKey, 'finalized');
  if (!account?.executable) return { account, programData: null, sha256: null };
  if (account.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID) && account.data.length >= 36 && account.data.readUInt32LE(0) === 2) {
    const address = new PublicKey(account.data.subarray(4, 36));
    const programData = await connection.getAccountInfo(address, 'finalized');
    return { account, programData, programDataAddress: address.toBase58(), sha256: programData ? createHash('sha256').update(programData.data).digest('hex') : null };
  }
  return { account, programData: account, programDataAddress: programKey.toBase58(), sha256: createHash('sha256').update(account.data).digest('hex') };
}

export function createAutomaticRewardChain({ connection, programId, authority, expectedProgramDataSha256, expectedVersion = REWARD_PROGRAM_VERSION }) {
  const program = new PublicKey(programId);
  if (!authority?.publicKey) throw new Error('A reward authority signer is required.');

  async function readiness() {
    const [genesisHash, evidence] = await Promise.all([connection.getGenesisHash(), readProgramDataEvidence(connection, program)]);
    const account = evidence.account;
    const reasons = [];
    if (genesisHash !== DEVNET_GENESIS_HASH) reasons.push('cluster-is-not-devnet');
    if (!account?.executable) reasons.push('program-is-not-executable');
    if (expectedVersion !== REWARD_PROGRAM_VERSION) reasons.push('program-version-not-approved');
    if (!expectedProgramDataSha256) reasons.push('program-data-hash-not-configured');
    if (expectedProgramDataSha256 && evidence.sha256 !== expectedProgramDataSha256.toLowerCase()) reasons.push('program-data-hash-mismatch');
    return { constrainedPayouts: reasons.length === 0, cluster: genesisHash === DEVNET_GENESIS_HASH ? 'devnet' : 'unknown', program: program.toBase58(), programDataAddress: evidence.programDataAddress || null, observedProgramDataSha256: evidence.sha256, reasons };
  }

  async function ensureVault(mint) {
    const { vault } = rewardAddresses({ programId: program, authority: authority.publicKey, mint });
    if (await connection.getAccountInfo(vault, 'finalized')) return vault;
    const instruction = new TransactionInstruction({
      programId: program,
      keys: [{ pubkey: authority.publicKey, isSigner: true, isWritable: true }, { pubkey: new PublicKey(mint), isSigner: false, isWritable: false }, { pubkey: vault, isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }],
      data: discriminator('global', 'initialize_reward_vault'),
    });
    await finalizedSend(connection, new Transaction().add(instruction), [authority]);
    return vault;
  }

  async function ensureCycle(plan) {
    const ready = await readiness();
    if (!ready.constrainedPayouts) throw new Error(`Reward chain unavailable: ${ready.reasons.join(', ')}`);
    const vault = await ensureVault(plan.mint);
    const { cycle } = rewardAddresses({ programId: program, authority: authority.publicKey, mint: plan.mint, cycleId: plan.manifest.cycleId });
    const existing = parseCycle(await connection.getAccountInfo(cycle, 'finalized'));
    const expected = { vault: vault.toBase58(), cycleId: plan.manifest.cycleId, root: plan.manifest.root, asset: plan.manifest.asset, totalAmount: plan.manifest.totalAmount, cutoffAt: plan.cutoffAt, payoutAt: plan.payoutAt, leafCount: plan.manifest.leaves.length };
    if (existing) {
      for (const key of Object.keys(expected)) if (String(existing[key]) !== String(expected[key])) throw new Error(`Existing reward cycle conflicts on ${key}.`);
      return { address: cycle.toBase58(), created: false };
    }
    const asset = plan.manifest.asset === 'SOL' ? SOL_ASSET_MINT : plan.manifest.asset;
    const data = Buffer.concat([discriminator('global', 'create_reward_cycle'), hex32(plan.manifest.cycleId, 'cycleId'), hex32(plan.manifest.root, 'root'), new PublicKey(asset).toBuffer(), u64(plan.manifest.totalAmount), i64(plan.cutoffAt), i64(plan.payoutAt), u32(plan.manifest.leaves.length)]);
    const instruction = new TransactionInstruction({ programId: program, keys: [{ pubkey: authority.publicKey, isSigner: true, isWritable: true }, { pubkey: vault, isSigner: false, isWritable: false }, { pubkey: cycle, isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }], data });
    const signature = await finalizedSend(connection, new Transaction().add(instruction), [authority]);
    const committed = parseCycle(await connection.getAccountInfo(cycle, 'finalized'));
    if (!committed || committed.root !== expected.root || committed.totalAmount !== expected.totalAmount) throw new Error('Reward cycle transaction finalized without the expected state delta.');
    return { address: cycle.toBase58(), created: true, signature };
  }

  async function submitLeaf(plan, leaf) {
    if (!verifyRewardProof({ cycleId: plan.manifest.cycleId, asset: plan.manifest.asset, recipient: leaf.recipient, amount: leaf.amount, index: leaf.index, proof: leaf.proof, root: plan.manifest.root })) throw new Error('Refusing to submit an invalid local Merkle proof.');
    const { vault, cycle, payment } = rewardAddresses({ programId: program, authority: authority.publicKey, mint: plan.mint, cycleId: plan.manifest.cycleId, recipient: leaf.recipient });
    const prior = parsePayment(await connection.getAccountInfo(payment, 'finalized'));
    if (prior) {
      if (prior.cycle !== cycle.toBase58() || prior.recipient !== leaf.recipient || prior.amount !== leaf.amount || prior.leafIndex !== leaf.index) throw new Error('Existing reward payment conflicts with the manifest.');
      return { signature: null, finalized: true, balanceDeltaVerified: true, payment: payment.toBase58(), alreadyPaid: true };
    }
    const proof = Buffer.concat(leaf.proof.map(node => hex32(node, 'proof node')));
    const data = Buffer.concat([discriminator('global', plan.manifest.asset === 'SOL' ? 'payout_reward_sol' : 'payout_reward_token'), u64(leaf.amount), u32(leaf.index), u32(leaf.proof.length), proof]);
    const recipient = new PublicKey(leaf.recipient);
    const keys = [{ pubkey: authority.publicKey, isSigner: true, isWritable: true }, { pubkey: vault, isSigner: false, isWritable: plan.manifest.asset === 'SOL' }, { pubkey: cycle, isSigner: false, isWritable: true }, { pubkey: recipient, isSigner: false, isWritable: plan.manifest.asset === 'SOL' }];
    const transaction = new Transaction();
    let before;
    if (plan.manifest.asset === 'SOL') {
      before = await connection.getBalance(recipient, 'finalized');
      keys.push({ pubkey: payment, isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false });
    } else {
      const mint = new PublicKey(plan.manifest.asset);
      const mintAccount = await connection.getAccountInfo(mint, 'finalized');
      if (!mintAccount || (!mintAccount.owner.equals(TOKEN_PROGRAM_ID) && !mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID))) throw new Error('Reward asset is not a finalized supported SPL mint.');
      const tokenProgram = mintAccount.owner;
      const vaultToken = getAssociatedTokenAddressSync(mint, vault, true, tokenProgram);
      const recipientToken = getAssociatedTokenAddressSync(mint, recipient, false, tokenProgram);
      transaction.add(createAssociatedTokenAccountIdempotentInstruction(authority.publicKey, recipientToken, recipient, mint, tokenProgram));
      try { before = BigInt((await connection.getTokenAccountBalance(recipientToken, 'finalized')).value.amount); } catch { before = 0n; }
      keys.push({ pubkey: mint, isSigner: false, isWritable: false }, { pubkey: vaultToken, isSigner: false, isWritable: true }, { pubkey: recipientToken, isSigner: false, isWritable: true }, { pubkey: payment, isSigner: false, isWritable: true }, { pubkey: tokenProgram, isSigner: false, isWritable: false }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false });
    }
    transaction.add(new TransactionInstruction({ programId: program, keys, data }));
    const cycleBefore = parseCycle(await connection.getAccountInfo(cycle, 'finalized'));
    const vaultBefore = plan.manifest.asset === 'SOL' ? await connection.getBalance(vault, 'finalized') : null;
    const signature = await finalizedSend(connection, transaction, [authority]);
    const record = parsePayment(await connection.getAccountInfo(payment, 'finalized'));
    if (!record || record.amount !== leaf.amount || record.recipient !== leaf.recipient || record.leafIndex !== leaf.index) throw new Error('Payout finalized without the expected payment record.');
    let after;
    if (plan.manifest.asset === 'SOL') {
      after = await connection.getBalance(recipient, 'finalized');
      const [vaultAfter, cycleAfter] = await Promise.all([
        connection.getBalance(vault, 'finalized'),
        connection.getAccountInfo(cycle, 'finalized').then(parseCycle),
      ]);
      if (BigInt(vaultBefore) - BigInt(vaultAfter) !== BigInt(leaf.amount)
        || !cycleBefore || !cycleAfter
        || BigInt(cycleAfter.distributedAmount) - BigInt(cycleBefore.distributedAmount) !== BigInt(leaf.amount)) {
        throw new Error('Payout record exists, but the exact vault and reward-cycle balance deltas were not observed.');
      }
      // When the recipient is also the transaction payer, rent and transaction
      // fees reduce its net SOL change. The exact vault/cycle deltas above are
      // the authoritative balance evidence for that self-payout.
      if (!recipient.equals(authority.publicKey) && BigInt(after) - BigInt(before) < BigInt(leaf.amount)) {
        throw new Error('Payout record exists, but the expected recipient balance delta was not observed.');
      }
    }
    else {
      const mint = new PublicKey(plan.manifest.asset), mintAccount = await connection.getAccountInfo(mint, 'finalized'), recipientToken = getAssociatedTokenAddressSync(mint, recipient, false, mintAccount.owner);
      after = BigInt((await connection.getTokenAccountBalance(recipientToken, 'finalized')).value.amount);
      if (BigInt(after) - BigInt(before) < BigInt(leaf.amount)) throw new Error('Payout record exists, but the expected recipient balance delta was not observed.');
    }
    return { signature, finalized: true, balanceDeltaVerified: true, payment: payment.toBase58(), vaultBalanceDeltaVerified: plan.manifest.asset === 'SOL' };
  }

  async function fundSolVault({ mint, amount }) {
    const vault = await ensureVault(mint), lamports = BigInt(amount);
    if (lamports <= 0n || lamports > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Invalid SOL vault funding amount.');
    const before = await connection.getBalance(vault, 'finalized');
    const signature = await finalizedSend(connection, new Transaction().add(SystemProgram.transfer({ fromPubkey: authority.publicKey, toPubkey: vault, lamports: Number(lamports) })), [authority]);
    const after = await connection.getBalance(vault, 'finalized');
    if (BigInt(after - before) !== lamports) throw new Error('SOL vault funding finalized without the exact expected balance delta.');
    return { signature, vault: vault.toBase58(), amount: String(lamports), balanceDeltaVerified: true };
  }

  async function fundSolVaultFromMintRouter({ mint, amount, fundingId }) {
    const vault = await ensureVault(mint);
    const settlement = buildMintRouterSettlementInstruction({ programId: program, mint, authority: authority.publicKey, recipient: vault, amountLamports: String(amount), obligationId: `automatic-reward:${fundingId}` });
    const expected = account => readMintClaimRecord(account, { programId: program, mint, recipient: vault, amountLamports: String(amount), claimId: settlement.claimId });
    const prior = await connection.getAccountInfo(settlement.claim, 'finalized');
    if (prior) {
      if (!expected(prior)) throw new Error('Existing mint-router funding claim conflicts with this reward pool.');
      return { signature: null, vault: vault.toBase58(), amount: String(amount), balanceDeltaVerified: true, alreadyFunded: true, claim: settlement.claim.toBase58() };
    }
    const before = await connection.getBalance(vault, 'finalized');
    const signature = await finalizedSend(connection, new Transaction().add(settlement.instruction), [authority]);
    const [after, claim] = await Promise.all([connection.getBalance(vault, 'finalized'), connection.getAccountInfo(settlement.claim, 'finalized')]);
    if (BigInt(after - before) !== BigInt(amount) || !expected(claim)) throw new Error('Mint-router reward funding finalized without the exact expected vault and claim-record deltas.');
    return { signature, vault: vault.toBase58(), amount: String(amount), balanceDeltaVerified: true, claim: settlement.claim.toBase58() };
  }

  async function fundTokenVault({ mint, asset, amount, decimals }) {
    const vault = await ensureVault(mint), assetKey = new PublicKey(asset), assetInfo = await connection.getAccountInfo(assetKey, 'finalized');
    if (!assetInfo || (!assetInfo.owner.equals(TOKEN_PROGRAM_ID) && !assetInfo.owner.equals(TOKEN_2022_PROGRAM_ID))) throw new Error('Funding asset is not a supported SPL mint.');
    const tokenProgram = assetInfo.owner;
    const source = getAssociatedTokenAddressSync(assetKey, authority.publicKey, false, tokenProgram), destination = getAssociatedTokenAddressSync(assetKey, vault, true, tokenProgram);
    const transaction = new Transaction().add(createAssociatedTokenAccountIdempotentInstruction(authority.publicKey, destination, vault, assetKey, tokenProgram), createTransferCheckedInstruction(source, assetKey, destination, authority.publicKey, BigInt(amount), decimals, [], tokenProgram));
    const before = await connection.getTokenAccountBalance(destination, 'finalized').then(row => BigInt(row.value.amount)).catch(() => 0n);
    const signature = await finalizedSend(connection, transaction, [authority]);
    const after = BigInt((await connection.getTokenAccountBalance(destination, 'finalized')).value.amount);
    if (after - before !== BigInt(amount)) throw new Error('Token vault funding finalized without the exact expected balance delta.');
    return { signature, vault: vault.toBase58(), tokenAccount: destination.toBase58(), amount: String(amount), balanceDeltaVerified: true };
  }

  return { readiness, ensureVault, ensureCycle, submitLeaf, fundSolVault, fundSolVaultFromMintRouter, fundTokenVault };
}
