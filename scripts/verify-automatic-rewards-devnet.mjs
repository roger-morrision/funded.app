import bs58 from 'bs58';
import { clusterApiUrl, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, sendAndConfirmTransaction, SystemProgram, Transaction } from '@solana/web3.js';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';
import { createAutomaticRewardChain, DEVNET_GENESIS_HASH } from '../server/automatic-reward-chain.mjs';
import { buildRewardManifest, createRewardCycleId } from '../reward-merkle.js';

const connection = new Connection(process.env.SOLANA_DEVNET_RPC_URL || process.env.SOLANA_RPC_URL || clusterApiUrl('devnet'), 'finalized');
const authority = Keypair.generate(), recipient = Keypair.generate(), launchMint = Keypair.generate().publicKey;
const programId = new PublicKey(process.env.FUNDED_FEE_ROUTER_PROGRAM_ID || process.env.VITE_FUNDED_FEE_ROUTER_PROGRAM_ID || '2tRrwGFzRCDmrVY7U6dny4Ea1RqVm7cSrCYFULmK7tik');
const chain = createAutomaticRewardChain({ connection, programId, authority, expectedProgramDataSha256: process.env.FUNDED_REWARD_PROGRAM_DATA_SHA256 });
async function getOrCreateFinalizedTokenAccount(mint, owner) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await getOrCreateAssociatedTokenAccount(connection, authority, mint, owner, false, 'finalized', { commitment:'finalized', preflightCommitment:'finalized' }); }
    catch (error) {
      lastError = error;
      if (attempt === 2 || error?.name !== 'TokenAccountNotFoundError') throw error;
      await new Promise(resolve => setTimeout(resolve, 750 * (attempt + 1)));
    }
  }
  throw lastError;
}
const genesisHash = await connection.getGenesisHash();
if (genesisHash !== DEVNET_GENESIS_HASH) throw new Error('Configured RPC is not Solana Devnet.');
const readiness = await chain.readiness();
if (!readiness.constrainedPayouts) {
  console.log(JSON.stringify({ status:'blocked', verification:'devnet-read-only', reasons:readiness.reasons, program:readiness.program, programDataAddress:readiness.programDataAddress, observedProgramDataSha256:readiness.observedProgramDataSha256, signer:'in-memory-ephemeral' }, null, 2));
  process.exitCode = 2;
} else if (process.env.DEVNET_REWARD_E2E !== 'true') {
  console.log(JSON.stringify({ status:'ready-not-executed', verification:'devnet-read-only', reason:'Set DEVNET_REWARD_E2E=true to authorize one ephemeral-wallet Devnet payout test.', program:readiness.program, signer:'in-memory-ephemeral' }, null, 2));
} else {
  const beforeFunding = await connection.getBalance(authority.publicKey, 'finalized');
  let testWalletFundingSignature = null, fundingSource;
  const requestedFunding = Number(process.env.DEVNET_REWARD_E2E_FUND_LAMPORTS || Math.floor(0.04 * LAMPORTS_PER_SOL));
  if (!Number.isSafeInteger(requestedFunding) || requestedFunding < 30_000_000 || requestedFunding > 80_000_000) throw new Error('DEVNET_REWARD_E2E_FUND_LAMPORTS must be between 0.03 and 0.08 Devnet SOL.');
  let configuredFunder = null;
  for (const name of ['SOLANA_DEVNET_CREATOR_SECRET_KEY', 'SOLANA_DEVNET_CLAIMANT_SECRET_KEY', 'SOLANA_DEVNET_REFERRER_SECRET_KEY']) {
    const encoded = String(process.env[name] || '').trim();
    if (!encoded) continue;
    const keypair = Keypair.fromSecretKey(bs58.decode(encoded));
    const balance = await connection.getBalance(keypair.publicKey, 'finalized');
    if (balance >= requestedFunding + 5_000_000) { configuredFunder = { name, keypair }; break; }
  }
  if (configuredFunder) {
    const funder = configuredFunder.keypair;
    fundingSource = `configured-devnet-test-wallet:${configuredFunder.name}`;
    testWalletFundingSignature = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(SystemProgram.transfer({ fromPubkey:funder.publicKey, toPubkey:authority.publicKey, lamports:requestedFunding })),
      [funder],
      { commitment:'finalized', preflightCommitment:'finalized' },
    );
  } else {
    fundingSource = 'devnet-faucet';
    testWalletFundingSignature = await connection.requestAirdrop(authority.publicKey, Math.floor(0.1 * LAMPORTS_PER_SOL));
    const latest = await connection.getLatestBlockhash('finalized');
    const confirmation = await connection.confirmTransaction({ signature:testWalletFundingSignature, ...latest }, 'finalized');
    if (confirmation.value.err) throw new Error('Devnet faucet transaction failed.');
  }
  const afterFunding = await connection.getBalance(authority.publicKey, 'finalized');
  if (afterFunding <= beforeFunding) throw new Error('Devnet funding did not produce a finalized ephemeral-wallet balance delta.');
  const now = Math.floor(Date.now() / 1000), amount = '1000000';
  const cycleId = createRewardCycleId({ mint:launchMint.toBase58(), kind:'holder', asset:'SOL', periodStart:now - 120, periodEnd:now - 60 });
  const manifest = buildRewardManifest({ cycleId, allocations:[{ recipient:recipient.publicKey.toBase58(), amount }] });
  const funding = await chain.fundSolVault({ mint:launchMint.toBase58(), amount:'5000000' });
  const plan = { mint:launchMint.toBase58(), cutoffAt:now - 60, payoutAt:now - 30, manifest };
  const cycle = await chain.ensureCycle(plan), payout = await chain.submitLeaf(plan, manifest.leaves[0]);
  if (!funding.balanceDeltaVerified || !payout.finalized || !payout.balanceDeltaVerified) throw new Error('Devnet reward E2E lacks required finalized balance deltas.');

  const tokenMint = await createMint(connection, authority, authority.publicKey, null, 6);
  const authorityToken = await getOrCreateFinalizedTokenAccount(tokenMint, authority.publicKey);
  const mintToSignature = await mintTo(connection, authority, tokenMint, authorityToken.address, authority, 10_000_000n);
  const tokenCycleId = createRewardCycleId({ mint:launchMint.toBase58(), kind:'holder', asset:tokenMint.toBase58(), periodStart:now - 120, periodEnd:now - 60 });
  const tokenManifest = buildRewardManifest({ cycleId:tokenCycleId, asset:tokenMint.toBase58(), allocations:[{ recipient:recipient.publicKey.toBase58(), amount:'2000000' }] });
  const tokenFunding = await chain.fundTokenVault({ mint:launchMint.toBase58(), asset:tokenMint.toBase58(), amount:'5000000', decimals:6 });
  const tokenPlan = { mint:launchMint.toBase58(), cutoffAt:now - 60, payoutAt:now - 30, manifest:tokenManifest };
  const tokenCycle = await chain.ensureCycle(tokenPlan), tokenPayout = await chain.submitLeaf(tokenPlan, tokenManifest.leaves[0]);
  if (!tokenFunding.balanceDeltaVerified || !tokenPayout.finalized || !tokenPayout.balanceDeltaVerified) throw new Error('Devnet token reward E2E lacks required finalized token-account deltas.');
  console.log(JSON.stringify({ status:'passed', verification:'devnet-end-to-end', program:readiness.program, authority:authority.publicKey.toBase58(), recipient:recipient.publicKey.toBase58(), launchMint:launchMint.toBase58(), fundingSource, testWalletFundingSignature, sol:{ vaultFundingSignature:funding.signature, cycleSignature:cycle.signature, payoutSignature:payout.signature, payment:payout.payment }, token:{ mint:tokenMint.toBase58(), mintToSignature, vaultFundingSignature:tokenFunding.signature, cycleSignature:tokenCycle.signature, payoutSignature:tokenPayout.signature, payment:tokenPayout.payment }, signer:'in-memory-ephemeral', privateKeyPersisted:false }, null, 2));
}
