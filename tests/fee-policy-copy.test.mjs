import test from 'node:test';
import assert from 'node:assert/strict';
import { setActiveProtocolFeeSplit, buildFeeDistributionPolicy } from '../distribution-policy.js';
import { PROTOCOL_FEE_SPLIT } from '../config/protocol-fee-split.js';
import { verifiedCoinRewardsPolicy } from '../coin-rewards-policy.js';
import { currentFeePolicyCopy } from '../src/features/fees/fee-policy-copy.js';

test('current page rules follow saved policy without rewriting historical token rates', () => {
  try {
    setActiveProtocolFeeSplit({ operationsPercent:50, referralLevelPercents:[10, 3, 2], communityPercent:10, buybackPercent:25 });
    const historical = { mint:'verified-mint', cluster:'devnet', onchainVerified:true, policySignature:'verified-signature',
      feeDistribution:buildFeeDistributionPolicy({ creatorWalletPercent:50, holderAirdropPercent:20, solClaimPercent:10, xRecipient:'@fundedvip' }) };
    setActiveProtocolFeeSplit(PROTOCOL_FEE_SPLIT);
    assert.match(currentFeePolicyCopy().allocation, /8% Operations & marketing/);
    assert.match(currentFeePolicyCopy().allocation, /4% Daily bonus/);
    const recorded = verifiedCoinRewardsPolicy(historical, 'verified-mint', 'devnet');
    assert.equal(recorded.protocolPrograms.operations, 10);
    assert.equal(recorded.protocolPrograms.community, 2);
    assert.equal(recorded.compact, 'Creator 50% · Holders 20% · @fundedvip 10%');
    setActiveProtocolFeeSplit({ operationsPercent:30, referralLevelPercents:[10, 3, 2], communityPercent:30, buybackPercent:25 });
    assert.match(currentFeePolicyCopy().allocation, /6% Operations & marketing/);
    assert.match(currentFeePolicyCopy().bonus, /6% Daily bonus pool/);
    assert.equal(verifiedCoinRewardsPolicy(historical, 'verified-mint', 'devnet').protocolPrograms.community, 2);
  } finally { setActiveProtocolFeeSplit(PROTOCOL_FEE_SPLIT); }
});
