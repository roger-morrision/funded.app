import assert from 'node:assert/strict';
import { Connection, Keypair, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, TokenAccountNotFoundError, getAccount, getAssociatedTokenAddressSync, getMint } from '@solana/spl-token';
import { OnlinePumpSdk } from '@pump-fun/pump-sdk';
import bs58 from 'bs58';
import { buildCommunityAirdropPolicy } from '../airdrop-policy.js';
import { buildFeeDistributionPolicy } from '../distribution-policy.js';
import { verifyFeeRouterAccount } from '../fee-router.js';
import { submitPumpDevnetLaunch, verifyPermanentPumpCreatorRoute } from '../launch-flow.js';

const mode = process.argv[2];
if (!['preflight', 'fund', 'recover', 'standard', 'custom-boost'].includes(mode)) {
  throw new Error('Choose preflight, fund, recover, standard, or custom-boost. Launch modes create a Devnet coin; custom-boost also burns 25,000 $FUNDED.');
}
if (process.env.VITE_SOLANA_CLUSTER !== 'devnet' || process.env.VITE_ALLOW_MAINNET !== 'false') {
  throw new Error('A Devnet-only .env.local profile is required.');
}
const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl('devnet');
const connection = new Connection(rpcUrl, 'confirmed');
const [rpcGenesis, devnetGenesis] = await Promise.all([
  connection.getGenesisHash(),
  new Connection(clusterApiUrl('devnet'), 'confirmed').getGenesisHash(),
]);
assert.equal(rpcGenesis, devnetGenesis, 'The configured RPC endpoint is not Solana Devnet.');
const walletName = process.argv[3] || 'creator';
const walletSecrets = {
  creator: process.env.SOLANA_DEVNET_CREATOR_SECRET_KEY,
  referrer: process.env.SOLANA_DEVNET_REFERRER_SECRET_KEY,
  claimant: process.env.SOLANA_DEVNET_CLAIMANT_SECRET_KEY,
};
if (!(walletName in walletSecrets) || !walletSecrets[walletName]) throw new Error('Choose a configured test wallet: creator, referrer, or claimant.');
const payer = Keypair.fromSecretKey(bs58.decode(walletSecrets[walletName]));
const fundedMint = new PublicKey(process.env.VITE_FUNDED_TOKEN_MINT);
const router = await verifyFeeRouterAccount({ connection, programId: process.env.VITE_FUNDED_FEE_ROUTER_PROGRAM_ID });
assert(router.verified, `Fee router is not verified: ${router.reason}`);
assert(!router.address.equals(payer.publicKey), 'The payer must not be the Pump fee owner.');

const tokenAccount = getAssociatedTokenAddressSync(fundedMint, payer.publicKey);
const [solLamports, funded, fundedWallet] = await Promise.all([
  connection.getBalance(payer.publicKey, 'confirmed'),
  getMint(connection, fundedMint),
  getAccount(connection, tokenAccount).catch(error => {
    if (error instanceof TokenAccountNotFoundError) return null;
    throw error;
  }),
]);
if (fundedWallet) assert(fundedWallet.owner.equals(payer.publicKey));
const fundedBalance = Number(fundedWallet?.amount || 0n) / 10 ** funded.decimals;
console.log(JSON.stringify({ mode, walletName, cluster: 'devnet', payer: payer.publicKey.toBase58(), router: router.address.toBase58(), solBalance: solLamports / 1e9, fundedMint: fundedMint.toBase58(), fundedBalance }));
if (mode === 'preflight') process.exit(0);
if (mode === 'recover') {
  const limit = Math.min(20, Math.max(1, Number(process.argv[4] || 3)));
  const signatures = await connection.getSignaturesForAddress(payer.publicKey, { limit }, 'confirmed');
  for (const entry of signatures) {
    const transaction = await connection.getParsedTransaction(entry.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    const mintAddresses = [...new Set((transaction?.meta?.postTokenBalances || []).map(item => item.mint))];
    for (const address of mintAddresses) {
      if (address === fundedMint.toBase58()) continue;
      const mintAddress = new PublicKey(address);
      const [mintAccount, curve] = await Promise.all([
        connection.getAccountInfo(mintAddress, 'confirmed'),
        new OnlinePumpSdk(connection).fetchBondingCurve(mintAddress).catch(() => null),
      ]);
      if (!mintAccount || !curve) continue;
      const mint = await getMint(connection, mintAddress, 'confirmed', mintAccount.owner);
      const feeRoute = verifyPermanentPumpCreatorRoute({ bondingCurve: curve, feeRouter: router.address, payer: payer.publicKey });
      const before = (transaction.meta.preTokenBalances || []).find(item => item.mint === fundedMint.toBase58());
      const after = (transaction.meta.postTokenBalances || []).find(item => item.mint === fundedMint.toBase58());
      const burnedUnits = before && after ? BigInt(before.uiTokenAmount.amount) - BigInt(after.uiTokenAmount.amount) : 0n;
      console.log(JSON.stringify({ signature: entry.signature, status: entry.err ? 'failed' : 'confirmed', mint: address, tokenProgram: mintAccount.owner.toBase58(), decimals: mint.decimals, supply: mint.supply.toString(), feeOwner: feeRoute.creator, feeOwnerVerified: feeRoute.verified, fundedBurned: Number(burnedUnits) / 10 ** funded.decimals }));
    }
  }
  process.exit(0);
}
if (mode === 'fund') {
  const signature = await connection.requestAirdrop(payer.publicKey, 1_000_000_000);
  await connection.confirmTransaction(signature, 'confirmed');
  console.log(JSON.stringify({ airdropSignature: signature, newSolBalance: await connection.getBalance(payer.publicKey, 'confirmed') / 1e9 }));
  process.exit(0);
}

assert(solLamports >= 30_000_000, 'Keep at least 0.03 Devnet SOL in the test wallet before launching.');
const custom = mode === 'custom-boost';
const communityAllocation = custom ? 50 : 3;
const shares = custom
  ? { creatorWalletPercent: 60, holderAirdropPercent: 10, solClaimPercent: 10, xRecipient: '@fundedqa' }
  : { creatorWalletPercent: 80, holderAirdropPercent: 0, solClaimPercent: 0 };
const feeDistribution = buildFeeDistributionPolicy({ ...shares, feeRouterAddress: router.address.toBase58() });
const communityAirdrop = buildCommunityAirdropPolicy({ allocationPercent: communityAllocation, supply: 1_000_000_000 });
assert.equal(feeDistribution.creatorDirected.shares.creatorWalletPercent + feeDistribution.creatorDirected.shares.holderAirdropPercent + feeDistribution.creatorDirected.shares.solClaimPercent, 80);
assert.equal(communityAirdrop.reservedTokens, communityAllocation * 10_000_000);
if (custom) assert(fundedBalance >= 25_000, 'The test wallet needs 25,000 $FUNDED for Boost.');
if (custom) assert(fundedWallet, 'Boost wallet needs an existing $FUNDED token account.');

const result = await submitPumpDevnetLaunch({
  connection,
  provider: { signTransaction: async transaction => { transaction.partialSign(payer); return transaction; } },
  payer: payer.publicKey,
  input: {
    name: `Funded ${custom ? 'Custom Boost' : 'Standard Quick'} QA ${Date.now().toString(36).slice(-5)}`,
    symbol: custom ? 'FCBQA' : 'FSQQA',
    supply: 1_000_000_000,
    decimals: 6,
  },
  feeRouterAddress: router.address.toBase58(),
  launchBurn: custom ? { tier: 'boost', amountTokens: 25_000, fundedMint: fundedMint.toBase58() } : null,
  onStatus: message => console.log(message),
});
console.log(JSON.stringify({ stage: 'launch-confirmed', mode, mint: result.mint.publicKey.toBase58(), signature: result.signature, feeOwner: result.feeRoute.creator }));

const pumpMintAccount = await connection.getAccountInfo(result.mint.publicKey, 'confirmed');
assert(pumpMintAccount, 'Pump mint account is missing.');
assert([TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()].includes(pumpMintAccount.owner.toBase58()), 'Pump mint is not an SPL token mint.');

const [mintAfter, fundedAfter, walletAfter] = await Promise.all([
  getMint(connection, result.mint.publicKey, 'confirmed', pumpMintAccount.owner),
  getMint(connection, fundedMint),
  fundedWallet ? getAccount(connection, tokenAccount) : Promise.resolve(null),
]);
assert.equal(mintAfter.decimals, 6);
assert.equal(mintAfter.supply, 1_000_000_000_000_000n);
assert.equal(result.feeRoute.creator, router.address.toBase58());
assert.equal(result.feeRoute.userHasCreatorFeeAuthority, false);
const burnedUnits = custom ? 25_000n * 10n ** BigInt(funded.decimals) : 0n;
assert.equal(funded.supply - fundedAfter.supply, burnedUnits);
if (fundedWallet) assert.equal(fundedWallet.amount - walletAfter.amount, burnedUnits);
assert.equal(Boolean(result.launchBurnReceipt), custom);

console.log(JSON.stringify({
  mode,
  mint: result.mint.publicKey.toBase58(),
  transaction: `https://explorer.solana.com/tx/${result.signature}?cluster=devnet`,
  feeOwner: result.feeRoute.creator,
  pumpSupply: mintAfter.supply.toString(),
  communityPolicyPercent: communityAllocation,
  creatorDirectedShares: feeDistribution.creatorDirected.shares,
  xAccount: feeDistribution.creatorDirected.recipients.xAccount,
  fundedBurned: custom ? 25_000 : 0,
  fundedSupplyBefore: funded.supply.toString(),
  fundedSupplyAfter: fundedAfter.supply.toString(),
  note: 'Community and fee distribution are policy calculations, not funded or executed by this launch transaction.',
}));
