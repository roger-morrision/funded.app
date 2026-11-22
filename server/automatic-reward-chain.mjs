import {parseCycleFields,parseCycle,parseLegacyCycle,parseReserve,parsePayment} from './reward-account-codec.mjs';
export {parseReserve} from './reward-account-codec.mjs';
import {rewardBitmap,bitmapPaid,rewardReceiptCleanup} from './reward-rent.mjs';
import {findRewardPayout} from './reward-payout-evidence.mjs';
import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { SOL_ASSET_MINT, verifyRewardProof } from '../reward-merkle.js';
import {readProgramDataEvidence} from './program-data-evidence.mjs';
import {requireNativeRewardRecipient} from './native-reward-recipient.mjs';
import {assertRpcNetwork,requireSolanaCluster,SOLANA_GENESIS} from '../solana-network.js';
import {financialProgramAllowed,financialRecordNetwork} from './financial-network.mjs';
import { signTransaction } from './transaction-signing.mjs';
import { createRewardBatchSubmitter } from './reward-batch.mjs';
import {parseProtocolGuard,rewardReviewDelaySeconds,routerHeaderLength} from '../protocol-guard.js';
import {executeRewardExpiry} from './reward-expiry-journal.mjs';
import {readCommittedRewardContext} from './reward-committed-context.mjs';
import {executeRewardPayout} from './reward-payout-journal.mjs';
export {readProgramDataEvidence};

// Solana may be reset. Keep this value aligned with the current official
// Solana RPC evidence and fail closed when the configured endpoint differs.
export const DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const REWARD_PROGRAM_VERSION = 'reward-manifest-v1';
const VAULT_SEED = Buffer.from('reward-vault-v1');
const RESERVE_SEED = Buffer.from('reward-reserve-v1');
const CYCLE_SEED = Buffer.from('reward-cycle-v1');
const PAYMENT_SEED = Buffer.from('reward-payment-v1');
const ROUTER_SEED = Buffer.from('funded-fee-router-v1');

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

export function verifiedTokenFundingDeltas({ sourceBefore, sourceAfter, vaultBefore, vaultAfter, requestedAmount }) {
  const gross = BigInt(requestedAmount);
  const debit = BigInt(sourceBefore) - BigInt(sourceAfter);
  const received = BigInt(vaultAfter) - BigInt(vaultBefore);
  if (gross <= 0n || debit !== gross || received <= 0n || received > gross) {
    throw new Error('Token vault funding lacks the expected gross debit and positive net receipt.');
  }
  return received.toString();
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

export function rewardReserveAddress({ programId, vault, asset }) {
  const [address] = PublicKey.findProgramAddressSync([RESERVE_SEED, new PublicKey(vault).toBuffer(),
    new PublicKey(asset === 'SOL' ? SOL_ASSET_MINT : asset).toBuffer()], new PublicKey(programId));
  return address;
}

export function communityProgramReserveAddress({ programId, authority }) {
  // The program ID is a reserved vault namespace, never a launched token mint.
  return rewardAddresses({ programId, authority, mint:programId }).vault;
}

export async function finalizedSend(connection, transaction, signers, { pollMs = 1000, timeoutMs = 90_000,
  cluster = 'devnet', programId, expectedProgramDataSha256, beforeBroadcast } = {}) {
  if (!Array.isArray(signers) || !signers.length) throw new Error('A reward transaction signer is required.');
  if (!financialProgramAllowed(cluster,programId,expectedProgramDataSha256)) throw new Error('Reward program has no reviewed release for this network.');
  await assertRpcNetwork(connection,cluster);
  if (cluster==='mainnet-beta') {
    const evidence=await readProgramDataEvidence(connection,new PublicKey(programId),{cluster});
    if (!evidence.account?.executable || evidence.sha256!==expectedProgramDataSha256?.toLowerCase())
      throw new Error('Reward program does not match the reviewed Mainnet release.');
  }
  const latest = await connection.getLatestBlockhash('finalized');
  const fresh = new Transaction({ feePayer:transaction.feePayer || signers[0].publicKey,
    recentBlockhash:latest.blockhash }).add(...transaction.instructions);
  await signTransaction(fresh, signers);
  const signature = bs58.encode(fresh.signature);
  const wire=fresh.serialize();
  if(beforeBroadcast)await beforeBroadcast({signature,transactionBase64:wire.toString('base64'),blockhash:latest.blockhash,lastValidBlockHeight:latest.lastValidBlockHeight});
  try {
    const submitted = await connection.sendRawTransaction(wire, {
      skipPreflight:false, preflightCommitment:'confirmed', maxRetries:2 });
    if (submitted !== signature) throw new Error('RPC returned a different reward transaction signature.');
  } catch (error) {
    // A transport failure can occur after submission. Reconcile this exact
    // signature; never sign a fresh transaction while its outcome is unknown.
    if (!/429|too many requests|timed? out|fetch failed|network/i.test(String(error?.message || error))) throw error;
  }
  const deadline = Date.now() + timeoutMs;
  let lastRpcError = null;
  while (Date.now() < deadline) {
    try {
      const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory:true })).value?.[0];
      if (status?.err) throw new Error(`Reward transaction failed: ${JSON.stringify(status.err)}`);
      if (status?.confirmationStatus === 'finalized') return signature;
      const height = await connection.getBlockHeight('finalized');
      if (height > latest.lastValidBlockHeight) break;
      lastRpcError = null;
    } catch (error) {
      if (/Reward transaction failed:/.test(String(error?.message || error))) throw error;
      lastRpcError = error;
    }
    await new Promise(resolveWait => setTimeout(resolveWait, pollMs));
  }
  const finalStatus = await connection.getSignatureStatuses([signature], { searchTransactionHistory:true }).catch(() => null);
  const status = finalStatus?.value?.[0];
  if (status?.err) throw new Error(`Reward transaction failed: ${JSON.stringify(status.err)}`);
  if (status?.confirmationStatus === 'finalized') return signature;
  throw new Error(`Reward transaction ${signature} has no verified finalized receipt; reconcile before retrying.${lastRpcError ? ` Last RPC error: ${String(lastRpcError.message || lastRpcError)}` : ''}`);
}

// Grace after payout_at before expire_reward_cycle may release a cycle's unpaid
// commitment; matches REWARD_CYCLE_EXPIRY_GRACE_SECONDS in the program build.
export function rewardCycleExpiryGraceSeconds(cluster) { return cluster === 'devnet' ? 600 : 30 * 24 * 60 * 60; }

// A payout whose confirmation was missed is later found already paid on-chain.
// The payment PDA is created by its payout, so the oldest successful finalized
// signature on that account is the payout transaction. Null when unavailable.
export async function recoverPaymentSignature(connection, payment) {
  try {
    const rows = await connection.getSignaturesForAddress(new PublicKey(payment), { limit: 50 }, 'finalized');
    const ok = (rows || []).filter(row => row && row.err === null && typeof row.signature === 'string');
    return rows?.length < 50 ? ok.at(-1)?.signature || null : null;
  } catch { return null; }
}

export function createAutomaticRewardChain({ connection, programId, authority, expectedProgramDataSha256, expectedVersion = REWARD_PROGRAM_VERSION, cluster = 'devnet' }) {
  requireSolanaCluster(cluster);
  const program = new PublicKey(programId);
  const [legacyRouter] = PublicKey.findProgramAddressSync([ROUTER_SEED], program);
  if (!authority?.publicKey) throw new Error('A reward authority signer is required.');

  async function readiness() {
    if (!financialProgramAllowed(cluster,program.toBase58(),expectedProgramDataSha256))
      return {constrainedPayouts:false,cluster,program:program.toBase58(),reasons:['program-release-not-reviewed']};
    const genesisHash = await assertRpcNetwork(connection,cluster);
    const [evidence, routerAccount] = await Promise.all([readProgramDataEvidence(connection, program,{cluster}), connection.getAccountInfo(legacyRouter, 'finalized')]);
    const account = evidence.account;
    const reasons = [];
    if (genesisHash !== SOLANA_GENESIS[cluster]) reasons.push('cluster-mismatch');
    if (!account?.executable) reasons.push('program-is-not-executable');
    if (expectedVersion !== REWARD_PROGRAM_VERSION) reasons.push('program-version-not-approved');
    if (!expectedProgramDataSha256) reasons.push('program-data-hash-not-configured');
    if (expectedProgramDataSha256 && evidence.sha256 !== expectedProgramDataSha256.toLowerCase()) reasons.push('program-data-hash-mismatch');
    const routerData = Buffer.from(routerAccount?.data || []);
    if (!routerAccount?.owner?.equals(program) || routerData.length !== routerHeaderLength(cluster) || routerData.subarray(0, 8).toString() !== 'FUNDFEE1' || !routerData.subarray(41, 73).equals(authority.publicKey.toBuffer())) reasons.push('router-authority-mismatch');
    if (parseProtocolGuard(routerData)?.paused) reasons.push('protocol-paused');
    return { constrainedPayouts: reasons.length === 0, cluster, genesisHash, program: program.toBase58(), programDataAddress: evidence.programDataAddress || null, observedProgramDataSha256: evidence.sha256, reasons };
  }

  async function requireReady(plan) {
    if (plan && !financialRecordNetwork(plan,cluster,{legacyDevnet:true})) throw new Error('Reward plan belongs to a different network.');
    const ready = await readiness();
    if (!ready.constrainedPayouts) throw new Error(`Reward chain unavailable: ${ready.reasons.join(', ')}`);
  }
  async function send(transaction,options={}) {
    await requireReady();
    return finalizedSend(connection,transaction,[authority],{cluster,programId:program.toBase58(),expectedProgramDataSha256,...options});
  }

  async function ensureVault(mint) {
    await requireReady();
    const { vault } = rewardAddresses({ programId: program, authority: authority.publicKey, mint });
    const [, bump] = PublicKey.findProgramAddressSync([VAULT_SEED, authority.publicKey.toBuffer(), new PublicKey(mint).toBuffer()], program);
    const validVault = account => {
      const data = Buffer.from(account?.data || []);
      return account?.owner?.equals(program) && data.length === 73
        && data.subarray(0, 8).equals(discriminator('account', 'RewardVault'))
        && data.subarray(8, 40).equals(authority.publicKey.toBuffer())
        && data.subarray(40, 72).equals(new PublicKey(mint).toBuffer()) && data[72] === bump;
    };
    const existing = await connection.getAccountInfo(vault, 'finalized');
    if (existing) {
      if (!validVault(existing)) throw new Error('Reward vault account failed program and authority verification.');
      return vault;
    }
    const instruction = new TransactionInstruction({
      programId: program,
      keys: [{ pubkey: authority.publicKey, isSigner: true, isWritable: true }, { pubkey: new PublicKey(mint), isSigner: false, isWritable: false }, { pubkey: vault, isSigner: false, isWritable: true }, { pubkey: legacyRouter, isSigner: false, isWritable: false }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }],
      data: discriminator('global', 'initialize_reward_vault'),
    });
    await send(new Transaction().add(instruction));
    if (!validVault(await connection.getAccountInfo(vault, 'finalized'))) throw new Error('Reward vault initialization lacks a verified finalized account.');
    return vault;
  }

  async function ensureReserve(vault, asset) {
    await requireReady();
    const assetKey = new PublicKey(asset === 'SOL' ? SOL_ASSET_MINT : asset);
    const reserve = rewardReserveAddress({ programId:program, vault, asset:assetKey });
    const valid = account => {
      const parsed = parseReserve(account);
      return account?.owner?.equals(program) && parsed?.vault === vault.toBase58() && parsed.asset === assetKey.toBase58();
    };
    const existing = await connection.getAccountInfo(reserve, 'finalized');
    if (existing) {
      if (!valid(existing)) throw new Error('Reward reserve account failed program, vault, and asset verification.');
      return reserve;
    }
    const instruction = new TransactionInstruction({programId:program, keys:[
      {pubkey:authority.publicKey,isSigner:true,isWritable:true}, {pubkey:vault,isSigner:false,isWritable:false},
      {pubkey:reserve,isSigner:false,isWritable:true}, {pubkey:legacyRouter,isSigner:false,isWritable:false},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}],
      data:Buffer.concat([discriminator('global','initialize_reward_reserve'),assetKey.toBuffer()])});
    await send(new Transaction().add(instruction));
    if (!valid(await connection.getAccountInfo(reserve,'finalized'))) throw new Error('Reward reserve initialization lacks a verified finalized account.');
    return reserve;
  }

  const committedContext=(plan,leaf)=>readCommittedRewardContext({connection,programId:program,currentAuthority:authority.publicKey,
    plan,cluster,recipient:leaf?.recipient,expectedProgramDataSha256});

  async function ensureCycle(plan, {bitmap=false} = {}) {
    if(bitmap && cluster!=='devnet')throw new Error('Bitmap cycles are Devnet only.');
    await requireReady(plan);
    if (new PublicKey(plan.mint).equals(program)) throw new Error('Community program reserve payouts require a separate published program flow.');
    if(plan.cycle){
      const saved=await committedContext(plan);
      if(!saved.legacy){
        if(!saved.record.reserved)throw new Error('Committed reward cycle is closed; no new payout may be prepared.');
        plan.receiptMode=saved.record.receiptMode;
        return {address:saved.cycle.toBase58(),created:false,receiptMode:saved.record.receiptMode};
      }
      if(!saved.originalAuthority.equals(authority.publicKey))throw new Error('Historical unreserved cycle migration requires authenticated original-authority handling.');
    }else if(plan.cycleSignature||Object.keys(plan.payments||{}).length||['distributing','paid','expired'].includes(plan.status)){
      throw new Error('Prior commitment lacks its saved cycle binding; reconcile before initialization.');
    }
    const vault = await ensureVault(plan.mint);
    const reserve = await ensureReserve(vault, plan.manifest.asset);
    const { cycle } = rewardAddresses({ programId: program, authority: authority.publicKey, mint: plan.mint, cycleId: plan.manifest.cycleId });
    const cycleAccount = await connection.getAccountInfo(cycle, 'finalized');
    if(cycleAccount&&!cycleAccount.owner?.equals(program))throw new Error('Existing reward cycle is not owned by the configured program.');
    const existing = parseCycle(cycleAccount);
    const legacy = parseLegacyCycle(cycleAccount);
    if (cycleAccount && !existing && !legacy) throw new Error('Existing reward cycle has an unrecognized layout.');
    const expected = { vault: vault.toBase58(), cycleId: plan.manifest.cycleId, root: plan.manifest.root, asset: plan.manifest.asset, totalAmount: plan.manifest.totalAmount, cutoffAt: plan.cutoffAt, payoutAt: plan.payoutAt, leafCount: plan.manifest.leaves.length };
    if (existing || legacy) {
      for (const key of Object.keys(expected)) if (String((existing || legacy)[key]) !== String(expected[key])) throw new Error(`Existing reward cycle conflicts on ${key}.`);
    }
    if (existing) {
      plan.receiptMode=existing.receiptMode;
      plan.cycle=cycle.toBase58();
      return { address: cycle.toBase58(), created: false, receiptMode:existing.receiptMode };
    }
    const asset = plan.manifest.asset === 'SOL' ? SOL_ASSET_MINT : plan.manifest.asset;
    const isSol = plan.manifest.asset === 'SOL';
    const reserveBefore = parseReserve(await connection.getAccountInfo(reserve, 'finalized'));
    if (!reserveBefore) throw new Error('Reward reserve is not verified before cycle creation.');
    const keys = [{ pubkey: authority.publicKey, isSigner: true, isWritable: true }, { pubkey: vault, isSigner: false, isWritable: false },
      { pubkey: reserve, isSigner: false, isWritable: true }, { pubkey: cycle, isSigner: false, isWritable: true }];
    if (!isSol) {
      const mintInfo = await connection.getAccountInfo(new PublicKey(asset), 'finalized');
      if (!mintInfo || (!mintInfo.owner.equals(TOKEN_PROGRAM_ID) && !mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID))) throw new Error('Reward asset is not a finalized supported SPL mint.');
      keys.push({pubkey:new PublicKey(asset),isSigner:false,isWritable:false},
        {pubkey:getAssociatedTokenAddressSync(new PublicKey(asset),vault,true,mintInfo.owner),isSigner:false,isWritable:false});
    }
    // Mainnet cycles retain the guardian review window. User entitlements
    // do not consume the administrative spending cap.
    if (!legacy && rewardReviewDelaySeconds(cluster) && Number(plan.payoutAt) < Math.floor(Date.now() / 1000) + rewardReviewDelaySeconds(cluster))
      throw new Error('Reward cycle payout is inside the Mainnet review delay; plan it with plannedRewardPayoutAt.');
    keys.push({ pubkey: legacyRouter, isSigner: false, isWritable: false }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false });
    const data = legacy
      ? Buffer.concat([discriminator('global', isSol ? 'migrate_reward_cycle_sol' : 'migrate_reward_cycle_token'), hex32(plan.manifest.cycleId, 'cycleId')])
      : Buffer.concat([discriminator('global', bitmap&&!legacy ? (isSol?'create_bitmap_cycle':'create_bitmap_cycle_token') : (isSol ? 'create_reward_cycle' : 'create_reward_cycle_token')), hex32(plan.manifest.cycleId, 'cycleId'), hex32(plan.manifest.root, 'root'), new PublicKey(asset).toBuffer(), u64(plan.manifest.totalAmount), i64(plan.cutoffAt), i64(plan.payoutAt), u32(plan.manifest.leaves.length)]);
    const instruction = new TransactionInstruction({ programId: program, keys, data });
    const signature = await send(new Transaction().add(instruction));
    const committedAccount=await connection.getAccountInfo(cycle,'finalized'),committed=parseCycle(committedAccount);
    if (!committedAccount?.owner?.equals(program)||!committed || committed.root !== expected.root || committed.totalAmount !== expected.totalAmount) throw new Error('Reward cycle transaction finalized without the expected state delta.');
    const reserveAfter = parseReserve(await connection.getAccountInfo(reserve, 'finalized'));
    const newlyReserved = legacy ? BigInt(legacy.totalAmount) - BigInt(legacy.distributedAmount) : BigInt(plan.manifest.totalAmount);
    if (!reserveAfter || BigInt(reserveAfter.outstanding) - BigInt(reserveBefore.outstanding) !== newlyReserved)
      throw new Error('Reward cycle finalized without the expected reserved liability delta.');
    plan.receiptMode=committed.receiptMode;
    plan.cycle=cycle.toBase58();
    return { address: cycle.toBase58(), created: !legacy, migrated: Boolean(legacy), signature,receiptMode:committed.receiptMode };
  }

  async function inspectLeaf(plan, leaf) {
    await requireReady(plan);
    return inspectReadyLeaf(plan, leaf);
  }

  async function inspectReadyLeaf(plan, leaf,context=null) {
    if (!verifyRewardProof({cycleId:plan.manifest.cycleId,asset:plan.manifest.asset,recipient:leaf.recipient,
      amount:leaf.amount,index:leaf.index,proof:leaf.proof,root:plan.manifest.root})) throw new Error('Invalid reviewed reward Merkle proof.');
    const resolved=context||await committedContext(plan,leaf);
    const {vault,cycle,payment,cycleInfo:cycleAccount,paymentInfo:paymentAccount,record:saved}=resolved;
    if(!saved||!cycleAccount.owner.equals(program)||saved.vault!==vault.toBase58()||saved.root!==plan.manifest.root
      ||saved.cycleId!==plan.manifest.cycleId||saved.asset!==plan.manifest.asset||saved.totalAmount!==plan.manifest.totalAmount
      ||saved.leafCount!==plan.manifest.leaves.length||saved.cutoffAt!==plan.cutoffAt||saved.payoutAt!==plan.payoutAt)
      throw new Error('Reward cycle differs from its frozen manifest.');
    plan.receiptMode=saved.receiptMode;
    if(saved.bitmap){
      if(bitmapPaid(saved.bitmap,leaf.index))return {payment:cycle.toBase58(),amount:leaf.amount,amountReceived:leaf.amount,finalized:true,bitmap:true};
      if(!saved.reserved)throw new Error('Reward cycle permanently closed; unpaid leaf cannot be retried.');
      return null;
    }
    if(!paymentAccount){
      if(!saved.reserved){
        const proof=await findRewardPayout(connection,{program,cycle,vault,payment,manifest:plan.manifest,leaf,bitmap:false},plan.payments?.[leaf.recipient]?.signature);
        return {...proof,payment:payment.toBase58(),reclaimed:true};
      }
      return null;
    }
    const record=parsePayment(paymentAccount);
    if(!paymentAccount.owner?.equals(program)||!cycleAccount?.owner?.equals(program)
      ||!saved||saved.vault!==vault.toBase58()||saved.cycleId!==plan.manifest.cycleId
      ||saved.root!==plan.manifest.root||saved.totalAmount!==plan.manifest.totalAmount
      ||saved.asset!==plan.manifest.asset||saved.leafCount!==plan.manifest.leaves.length
      ||saved.cutoffAt!==plan.cutoffAt||saved.payoutAt!==plan.payoutAt
      ||!record||record.cycle!==cycle.toBase58()||record.recipient!==leaf.recipient
      ||record.amount!==leaf.amount||record.leafIndex!==leaf.index||record.receivedAmount===null
      ||BigInt(record.receivedAmount)<=0n||BigInt(record.receivedAmount)>BigInt(record.amount))
      throw new Error('Finalized reward payment conflicts with the frozen manifest.');
    return {payment:payment.toBase58(),amount:record.amount,amountReceived:record.receivedAmount,finalized:true};
  }

  async function prepareLeaf(plan, leaf, readyChecked = false) {
    if (!readyChecked) await requireReady(plan);
    if (!verifyRewardProof({ cycleId: plan.manifest.cycleId, asset: plan.manifest.asset, recipient: leaf.recipient, amount: leaf.amount, index: leaf.index, proof: leaf.proof, root: plan.manifest.root })) throw new Error('Refusing to submit an invalid local Merkle proof.');
    const context=await committedContext(plan,leaf),{vault,cycle,payment}=context;
    const prior = await inspectReadyLeaf(plan,leaf,context);
    if (prior) {
      const proof=prior.bitmap?await findRewardPayout(connection,{program,cycle,vault,payment,manifest:plan.manifest,leaf,bitmap:true},plan.payments?.[leaf.recipient]?.signature):null;
      return { paid:{ signature: proof?.signature||prior.signature||await recoverPaymentSignature(connection,payment), finalized: true, balanceDeltaVerified: true, amountReceived: prior.amountReceived, payment: prior.payment, bitmap:prior.bitmap===true, alreadyPaid: true } };
    }
    const proof = Buffer.concat(leaf.proof.map(node => hex32(node, 'proof node')));
    const data = Buffer.concat([discriminator('global', plan.receiptMode==='bitmap' ? (plan.manifest.asset==='SOL'?'payout_bitmap_sol':'payout_bitmap_token') : (plan.manifest.asset === 'SOL' ? 'payout_reward_sol' : 'payout_reward_token')), u64(leaf.amount), u32(leaf.index), u32(leaf.proof.length), proof]);
    const recipient = new PublicKey(leaf.recipient);
    const reserve = rewardReserveAddress({programId:program,vault,asset:plan.manifest.asset});
    const keys = [{ pubkey: authority.publicKey, isSigner: true, isWritable: true }, { pubkey: vault, isSigner: false, isWritable: plan.manifest.asset === 'SOL' },
      { pubkey: reserve, isSigner: false, isWritable: true }, { pubkey: cycle, isSigner: false, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: plan.manifest.asset === 'SOL' }];
    const transaction = new Transaction();
    let before;
    let vaultTokenAddress = null, vaultTokenBefore = null, recipientTokenAddress = null;
    if (plan.manifest.asset === 'SOL') {
      before = await connection.getBalance(recipient, 'finalized');
      await requireNativeRewardRecipient(connection,recipient,leaf.amount,before);
      keys.push({ pubkey: payment, isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false });
    } else {
      const mint = new PublicKey(plan.manifest.asset);
      const mintAccount = await connection.getAccountInfo(mint, 'finalized');
      if (!mintAccount || (!mintAccount.owner.equals(TOKEN_PROGRAM_ID) && !mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID))) throw new Error('Reward asset is not a finalized supported SPL mint.');
      const tokenProgram = mintAccount.owner;
      const vaultToken = getAssociatedTokenAddressSync(mint, vault, true, tokenProgram);
      vaultTokenAddress = vaultToken;
      const recipientToken = getAssociatedTokenAddressSync(mint, recipient, false, tokenProgram);
      recipientTokenAddress = recipientToken;
      transaction.add(createAssociatedTokenAccountIdempotentInstruction(authority.publicKey, recipientToken, recipient, mint, tokenProgram));
      try { before = BigInt((await connection.getTokenAccountBalance(recipientToken, 'finalized')).value.amount); } catch { before = 0n; }
      vaultTokenBefore = BigInt((await connection.getTokenAccountBalance(vaultToken, 'finalized')).value.amount);
      keys.push({ pubkey: mint, isSigner: false, isWritable: false }, { pubkey: vaultToken, isSigner: false, isWritable: true }, { pubkey: recipientToken, isSigner: false, isWritable: true }, { pubkey: payment, isSigner: false, isWritable: true }, { pubkey: tokenProgram, isSigner: false, isWritable: false }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false });
    }
    if(plan.receiptMode==='bitmap'){
      if(recipient.equals(authority.publicKey))throw new Error('Operational authority cannot receive a bitmap reward.');
      keys.splice(keys.findIndex(k=>k.pubkey.equals(payment)),1);
    }
    if (cluster === 'mainnet-beta') keys.push({ pubkey: legacyRouter, isSigner: false, isWritable: false });
    transaction.add(new TransactionInstruction({ programId: program, keys, data }));
    return { leaf, transaction, recipient, payment:plan.receiptMode==='bitmap'?cycle:payment,bitmap:plan.receiptMode==='bitmap', cycle, reserve, vault, before, vaultTokenAddress, vaultTokenBefore, recipientTokenAddress,context };
  }

  async function submitLeaf(plan,leaf,{store,recoveryOnly=false}={}){
    if(store)return executeRewardPayout({store,plan,leaf,connection,programId:program,currentAuthority:authority.publicKey,
      cluster,expectedProgramDataSha256,prepareLeaf,send,recoveryOnly,submitBitmap:submitUnjournaledLeaf});
    if(recoveryOnly||cluster==='mainnet-beta')throw new Error('Durable payout store required; no fresh signing authorized.');
    return submitUnjournaledLeaf(plan,leaf);
  }

  async function submitUnjournaledLeaf(plan, leaf) {
    const prepared = await prepareLeaf(plan, leaf);
    if (prepared.paid) return prepared.paid;
    if(prepared.bitmap){const [outcome]=await submitLeaves(plan,[leaf]);if(outcome.error)throw outcome.error;return outcome.result;}
    const { transaction, recipient, payment, cycle, reserve, vault, before, vaultTokenAddress, vaultTokenBefore } = prepared;
    const cycleBefore = parseCycle(await connection.getAccountInfo(cycle, 'finalized'));
    const reserveBefore = parseReserve(await connection.getAccountInfo(reserve, 'finalized'));
    if (!cycleBefore || !reserveBefore) throw new Error('Reward cycle or reserve account is not verified before payout.');
    const vaultBefore = plan.manifest.asset === 'SOL' ? await connection.getBalance(vault, 'finalized') : null;
    const signature = await send(transaction);
    const record = parsePayment(await connection.getAccountInfo(payment, 'finalized'));
    if (!record || record.amount !== leaf.amount || record.recipient !== leaf.recipient || record.leafIndex !== leaf.index) throw new Error('Payout finalized without the expected payment record.');
    if (record.receivedAmount === null || BigInt(record.receivedAmount) <= 0n || BigInt(record.receivedAmount) > BigInt(leaf.amount)) throw new Error('Payout record lacks a valid net received amount.');
    const reserveAfter = parseReserve(await connection.getAccountInfo(reserve, 'finalized'));
    if (!reserveAfter || BigInt(reserveBefore.outstanding) - BigInt(reserveAfter.outstanding) !== BigInt(leaf.amount))
      throw new Error('Payout finalized without the exact reserved liability release.');
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
      const vaultTokenAfter = BigInt((await connection.getTokenAccountBalance(vaultTokenAddress, 'finalized')).value.amount);
      if (vaultTokenBefore - vaultTokenAfter !== BigInt(leaf.amount)
        || BigInt(after) - BigInt(before) < BigInt(record.receivedAmount)) throw new Error('Payout record exists, but the expected gross debit and net recipient balance delta were not observed.');
    }
    return { signature, finalized: true, balanceDeltaVerified: true, amountReceived: record.receivedAmount, payment: payment.toBase58(), vaultBalanceDeltaVerified: true };
  }

  async function fundSolVault({ mint, amount }) {
    const vault = await ensureVault(mint), lamports = BigInt(amount);
    if (lamports <= 0n || lamports > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Invalid SOL vault funding amount.');
    const before = await connection.getBalance(vault, 'finalized');
    const signature = await send(new Transaction().add(SystemProgram.transfer({ fromPubkey: authority.publicKey, toPubkey: vault, lamports: Number(lamports) })));
    const after = await connection.getBalance(vault, 'finalized');
    if (BigInt(after - before) !== lamports) throw new Error('SOL vault funding finalized without the exact expected balance delta.');
    return { signature, vault: vault.toBase58(), amount: String(lamports), balanceDeltaVerified: true };
  }

  async function fundTokenVault({ mint, asset, amount, decimals }) {
    const vault = await ensureVault(mint), assetKey = new PublicKey(asset), assetInfo = await connection.getAccountInfo(assetKey, 'finalized');
    if (!assetInfo || (!assetInfo.owner.equals(TOKEN_PROGRAM_ID) && !assetInfo.owner.equals(TOKEN_2022_PROGRAM_ID))) throw new Error('Funding asset is not a supported SPL mint.');
    const gross = BigInt(amount);
    if (gross <= 0n || gross > 0xffffffffffffffffn) throw new Error('Invalid token vault funding amount.');
    const tokenProgram = assetInfo.owner;
    const source = getAssociatedTokenAddressSync(assetKey, authority.publicKey, false, tokenProgram), destination = getAssociatedTokenAddressSync(assetKey, vault, true, tokenProgram);
    const transaction = new Transaction().add(createAssociatedTokenAccountIdempotentInstruction(authority.publicKey, destination, vault, assetKey, tokenProgram), createTransferCheckedInstruction(source, assetKey, destination, authority.publicKey, gross, decimals, [], tokenProgram));
    const sourceBefore = BigInt((await connection.getTokenAccountBalance(source, 'finalized')).value.amount);
    const vaultBefore = await connection.getTokenAccountBalance(destination, 'finalized').then(row => BigInt(row.value.amount)).catch(() => 0n);
    const signature = await send(transaction);
    const [sourceAfter, vaultAfter] = await Promise.all([source, destination].map(address =>
      connection.getTokenAccountBalance(address, 'finalized').then(row => BigInt(row.value.amount))));
    const netAmount = verifiedTokenFundingDeltas({ sourceBefore, sourceAfter, vaultBefore, vaultAfter, requestedAmount: gross });
    return { signature, vault: vault.toBase58(), tokenAccount: destination.toBase58(), amount: netAmount,
      grossAmount: gross.toString(), balanceDeltaVerified: true };
  }

  // Release the unpaid part of a reserved cycle that can never be fully paid.
  // Tokens stay in the vault; the program rejects every later payout of the cycle.
  async function expireCycle(plan,{store,recoveryOnly=false}={}) {
    return executeRewardExpiry({store,plan,connection,programId:program,currentAuthority:authority.publicKey,
      cluster,expectedProgramDataSha256,send,requireReady,recoveryOnly});
  }

  const submitLeaves = createRewardBatchSubmitter({ cluster, connection, authority, requireReady,
    prepareLeaf:(plan, leaf) => prepareLeaf(plan, leaf, true), inspectLeaf:inspectReadyLeaf, submitLeaf, send });
  const cleanupReceipts=rewardReceiptCleanup({cluster,connection,program,authority,legacyRouter,parseCycle:parseCycleFields,requireReady,send,
    verifyArchive:(plan,leaf,signature)=>findRewardPayout(connection,{program,...rewardAddresses({programId:program,authority:authority.publicKey,mint:plan.mint,cycleId:plan.manifest.cycleId,recipient:leaf.recipient}),manifest:plan.manifest,leaf,bitmap:false},signature),
    addresses:(plan,leaf)=>rewardAddresses({programId:program,authority:authority.publicKey,mint:plan.mint,cycleId:plan.manifest.cycleId,recipient:leaf?.recipient})});
  return { cleanupReceipts,cluster, readiness, ensureVault, ensureCycle, inspectLeaf, submitLeaf, submitLeaves, expireCycle, fundSolVault, fundTokenVault,
    paymentSignature: payment => recoverPaymentSignature(connection, payment),
    cycleExpiryGraceSeconds: rewardCycleExpiryGraceSeconds(cluster) };
}
