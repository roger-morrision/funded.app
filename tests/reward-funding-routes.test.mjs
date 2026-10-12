import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import bs58 from 'bs58';
import { Keypair, Transaction } from '@solana/web3.js';
import { deriveMintFeeLedger, deriveMintFeeRouter, FEE_ROUTER_POLICY_HASH_HEX,
  MINT_FEE_ROUTER_MAGIC, MINT_FEE_ROUTER_VERSION } from '../fee-router.js';
import { buildMintRouterSettlementInstruction } from '../server/mint-router-payout.mjs';
import { createRewardFundingRoutes } from '../server/routes/reward-funding.mjs';

test('creator approves exact holder funding and the route records finalized vault evidence', async () => {
  const programId = Keypair.generate().publicKey, mint = Keypair.generate().publicKey;
  const creator = Keypair.generate(), authority = Keypair.generate(), vault = Keypair.generate().publicKey;
  const router = deriveMintFeeRouter(programId, mint).address, ledger = deriveMintFeeLedger(programId, mint).address;
  const routerData = Buffer.alloc(106);
  routerData.write(MINT_FEE_ROUTER_MAGIC, 0);
  routerData[8] = MINT_FEE_ROUTER_VERSION;
  Buffer.from(FEE_ROUTER_POLICY_HASH_HEX, 'hex').copy(routerData, 9);
  authority.publicKey.toBuffer().copy(routerData, 41);
  mint.toBuffer().copy(routerData, 73);
  routerData[105] = deriveMintFeeRouter(programId, mint).bump;
  const ledgerData = Buffer.alloc(89);
  Buffer.from('ba58179168761966', 'hex').copy(ledgerData, 0);
  mint.toBuffer().copy(ledgerData, 8);
  creator.publicKey.toBuffer().copy(ledgerData, 40);
  ledgerData[88] = deriveMintFeeLedger(programId, mint).bump;
  const account = new Map([[router.toBase58(), { owner:programId, data:routerData }],
    [ledger.toBase58(), { owner:programId, data:ledgerData }]]);
  const sourceSignature = 'finalized-collection';
  const requestId = `${sourceSignature}:holders`;
  const main = { launches:{ [mint.toBase58()]:{ mint:mint.toBase58(), creatorWallet:creator.publicKey.toBase58(),
    creator:router.toBase58(), onchainVerified:true, cluster:'devnet',
    pumpFeeRoute:{ scope:'per-mint-v2', router:router.toBase58() } } },
  collections:{ [sourceSignature]:{ mint:mint.toBase58(), router:router.toBase58(), cluster:'devnet',
    status:'collected', attribution:'mint-verified', onchainVerified:true } },
  settlements:{ [sourceSignature]:{ creatorDestinations:{ holderAirdrop:0.001790808 } } } };
  const rewards = { fundingRequests:{ [requestId]:{ id:requestId, sourceSignature, mint:mint.toBase58(),
    asset:'SOL', kind:'holder', amount:'1790808', recipient:null, status:'pending' } } };
  let finalizedSignature = null;
  const connection = {
    getAccountInfo:async key => account.get(key.toBase58()) || null,
    getLatestBlockhash:async () => ({ blockhash:Keypair.generate().publicKey.toBase58(), lastValidBlockHeight:100 }),
    isBlockhashValid:async () => ({ value:true }),
    sendRawTransaction:async bytes => {
      const transaction = Transaction.from(bytes);
      assert.equal(transaction.verifySignatures(), true);
      finalizedSignature = bs58.encode(transaction.signature);
      const settlement = buildMintRouterSettlementInstruction({ programId, mint, authority:authority.publicKey,
        creator:creator.publicKey, recipient:vault, amountLamports:'1790808', obligationId:requestId,
        claimDomain:'holder-funding' });
      const data = Buffer.alloc(121);
      createHash('sha256').update('account:MintClaimRecord').digest().copy(data, 0, 0, 8);
      settlement.claimId.copy(data, 8);
      mint.toBuffer().copy(data, 40);
      vault.toBuffer().copy(data, 72);
      data.writeBigUInt64LE(1790808n, 104);
      data[120] = 0;
      account.set(settlement.claim.toBase58(), { owner:programId, data });
      return finalizedSignature;
    },
    getSignatureStatuses:async () => ({ value:[{ err:null, confirmationStatus:'finalized' }] }),
    getTransaction:async signature => ({ transaction:{ signatures:[signature], message:{ accountKeys:[router,vault] } },
      meta:{ err:null, preBalances:[3000000,1000000], postBalances:[1209192,2790808] } }),
  };
  const responses = [];
  const priorAuthority = process.env.FUNDED_REWARD_AUTHORITY;
  process.env.FUNDED_REWARD_AUTHORITY = authority.publicKey.toBase58();
  try {
    const handle = createRewardFundingRoutes({ store:{ read:async()=>structuredClone(main) },
      automaticRewardStore:{ read:async()=>structuredClone(rewards), transaction:async update=>update(rewards) },
      solanaCluster:'devnet', solanaRpcUrl:'https://api.devnet.solana.com',
      feeRouterConfig:()=>({ programId }), mintRouterReadiness:async()=>({ ready:true }),
      routerAuthorityKeypair:()=>authority, body:async req=>req.input,
      respond:(_res,status,data)=>responses.push({ status,data }), connectionFactory:()=>connection,
      chainFactory:()=>({ readiness:async()=>({ constrainedPayouts:true }), ensureVault:async()=>vault }) });
    const request = async (suffix, input = {}, method = 'POST') => {
      const origin = process.env.CORS_ORIGIN && process.env.CORS_ORIGIN !== '*' ? process.env.CORS_ORIGIN : 'https://funded.vip';
      return handle({ method, input, headers:{ origin, host:'funded.vip' }, socket:{ encrypted:true } }, {},
        new URL(`/api/tokens/${mint.toBase58()}/reward-funding/${suffix}`, 'https://funded.vip'));
    };
    await request('pending', {}, 'GET');
    assert.equal(responses.at(-1).status, 200);
    assert.deepEqual(responses.at(-1).data.requests.map(row=>row.id), [requestId]);
    await request('settle', { requestId });
    const review = responses.at(-1);
    assert.equal(review.status, 202);
    assert.equal(review.data.status, 'awaiting-creator-signature');
    assert.equal(review.data.recipient, vault.toBase58());
    const transaction = Transaction.from(Buffer.from(review.data.transaction, 'base64'));
    transaction.partialSign(creator);
    await request('settle', { requestId, creatorSignedTransaction:transaction.serialize({
      requireAllSignatures:false, verifySignatures:false }).toString('base64') });
    assert.equal(responses.at(-1).data.status, 'vault-funded');
    assert.equal(responses.at(-1).data.signature, finalizedSignature);
    assert.equal(rewards.fundingRequests[requestId].status, 'funding');
    assert.equal(rewards.fundingRequests[requestId].approvedCreator, creator.publicKey.toBase58());
    await request('settle', { requestId });
    assert.equal(responses.at(-1).status, 202);
    assert.equal(responses.at(-1).data.signature, finalizedSignature);
  } finally {
    if (priorAuthority === undefined) delete process.env.FUNDED_REWARD_AUTHORITY;
    else process.env.FUNDED_REWARD_AUTHORITY = priorAuthority;
  }
});
