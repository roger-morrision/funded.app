import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair } from '@solana/web3.js';
import { buildMintRouterSettlementInstruction } from '../server/mint-router-payout.mjs';
import { verifiedRewardFundingRequests } from '../server/reward-funding-claim.mjs';

const mint = Keypair.generate().publicKey.toBase58();
const creator = Keypair.generate().publicKey.toBase58();
const router = Keypair.generate().publicKey.toBase58();
const operations = Keypair.generate().publicKey.toBase58();
const signature = 'verified-collection';
const launch = { mint, creatorWallet:creator, creator:router, cluster:'devnet', onchainVerified:true,
  pumpFeeRoute:{ scope:'per-mint-v2', router } };
const collections = { [signature]:{ mint, router, cluster:'devnet', status:'collected', attribution:'mint-verified', onchainVerified:true } };
const settlements = { [signature]:{ creatorDestinations:{ holderAirdrop:0.001790808 },
  fundedApp:{ operations:0.001790808, community:0.000358162 } } };
const fundingRequests = {
  [`${signature}:holders`]:{ id:`${signature}:holders`, sourceSignature:signature, mint, asset:'SOL', kind:'holder',
    amount:'1790808', recipient:null, status:'awaiting-creator-signature' },
  [`${signature}:operations`]:{ id:`${signature}:operations`, sourceSignature:signature, mint, asset:'SOL', kind:'operations',
    amount:'1790808', recipient:operations, status:'pending' },
  [`${signature}:community`]:{ id:`${signature}:community`, sourceSignature:signature, mint, asset:'SOL', kind:'community-reserve',
    amount:'358162', recipient:null, status:'pending' },
};
const input = () => ({ mint, wallet:creator, launch, collections, settlements,
  operationsRecipient:operations, rewardState:{ fundingRequests:structuredClone(fundingRequests) } });

test('only immutable verified fee allocations can request creator-approved funding', () => {
  assert.deepEqual(verifiedRewardFundingRequests(input()).map(row => row.kind), ['community-reserve','holder','operations']);
  const tampered = input();
  tampered.rewardState.fundingRequests[`${signature}:holders`].amount = '1790809';
  tampered.rewardState.fundingRequests[`${signature}:operations`].recipient = creator;
  tampered.rewardState.fundingRequests[`${signature}:community`].sourceSignature = 'other-collection';
  assert.equal(verifiedRewardFundingRequests(tampered).length, 0);
  assert.equal(verifiedRewardFundingRequests({ ...input(), wallet:operations }).length, 0);
  assert.equal(verifiedRewardFundingRequests({ ...input(), collections:{} }).length, 0);
});

test('holder, operations, and community claims have separate IDs and correct shares', () => {
  const programId = Keypair.generate().publicKey;
  const authority = Keypair.generate().publicKey;
  const destination = Keypair.generate().publicKey;
  const build = claimDomain => buildMintRouterSettlementInstruction({ programId, mint, authority,
    creator, recipient:destination, amountLamports:'1000', obligationId:`${signature}:holders`, claimDomain });
  const holder = build('holder-funding'), operationsClaim = build('operations-funding'), community = build('community-reserve');
  assert.equal(holder.share, 0);
  assert.equal(operationsClaim.share, 1);
  assert.equal(community.share, 1);
  assert.equal(new Set([holder.claim.toBase58(), operationsClaim.claim.toBase58(), community.claim.toBase58()]).size, 3);
  assert.throws(() => buildMintRouterSettlementInstruction({ programId, mint, authority,
    recipient:destination, amountLamports:'1000', obligationId:'x', claimDomain:'holder-funding' }), /Creator wallet signature/);
});
