import assert from 'node:assert/strict';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Keypair } from '@solana/web3.js';
import { claimableCreatorRequests, creatorClaimStatus, createCreatorFeeChallenges } from '../server/creator-fee-claim.mjs';

const wallet = Keypair.generate();
const other = Keypair.generate();
const mint = Keypair.generate().publicKey.toBase58();
const address = wallet.publicKey.toBase58();
const router = Keypair.generate().publicKey.toBase58();
const launch = { mint, creator:router, cluster:'devnet', onchainVerified:true, creatorWallet:address, pumpFeeRoute:{ scope:'per-mint-v2', router } };
const collections = Object.fromEntries(['a','b'].map(signature => [signature, { mint, router, cluster:'devnet', status:'collected', attribution:'mint-verified', onchainVerified:true }]));
const settlements = { a:{ creatorDestinations:{ creatorWallet:0.006 } }, b:{ creatorDestinations:{ creatorWallet:0.005 } } };
const rewardState = { fundingRequests: {
  'a:creator':{ id:'a:creator', sourceSignature:'a', kind:'creator', asset:'SOL', mint, recipient:address, status:'claimable', amount:'6000000' },
  'b:creator':{ id:'b:creator', sourceSignature:'b', kind:'creator', asset:'SOL', mint, recipient:address, status:'claimable', amount:'5000000' },
  'a:x':{ id:'a:x', sourceSignature:'a', kind:'x', mint, recipient:address, status:'claimable', amount:'90000000' },
} };
const input = { mint, wallet:address, launch, collections, settlements, rewardState };
assert.equal(claimableCreatorRequests(input).length, 2);
const status = creatorClaimStatus(input);
assert.equal(status.claimableLamports, '11000000');
assert.equal(status.eligible, true);
assert.equal(creatorClaimStatus({ ...input, wallet:other.publicKey.toBase58() }).eligible, false);
const challenges = createCreatorFeeChallenges();
const challenge = challenges.prepare({ mint, wallet:address, status, origin:'https://funded.vip' });
const wrong = bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.statement), other.secretKey));
assert.equal(challenges.verify({ challengeId:challenge.challengeId, signature:wrong, origin:'https://funded.vip', status }), null);
const signed = bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.statement), wallet.secretKey));
assert.equal(challenges.verify({ challengeId:challenge.challengeId, signature:signed, origin:'https://wrong.example', status }), null);
assert.equal(challenges.verify({ challengeId:challenge.challengeId, signature:signed, origin:'https://funded.vip', status:{ ...status, claimableLamports:'12000000' } }), null);
assert.equal(challenges.verify({ challengeId:challenge.challengeId, signature:signed, origin:'https://funded.vip', status }).wallet, address);
assert.equal(challenges.verify({ challengeId:challenge.challengeId, signature:signed, origin:'https://funded.vip', status }), null);
rewardState.fundingRequests['b:creator'].status = 'pending';
assert.equal(creatorClaimStatus(input).eligible, false);
console.log('creator fee claim: verified launch, minimum, wallet signature, exact amount and replay checks');
