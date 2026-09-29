import { createHash } from 'node:crypto';
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import { rewardAddresses } from './automatic-reward-chain.mjs';

const vaultDiscriminator = createHash('sha256').update('account:RewardVault').digest().subarray(0, 8);

export async function readCommunityReserveStatus({ connection, programId, authority, fundingAuthority = authority, mint, reservedTokens, fundingSignature = null }) {
  const mintKey = new PublicKey(mint), issuer = new PublicKey(authority), funder = new PublicKey(fundingAuthority), program = new PublicKey(programId);
  const mintInfo = await connection.getAccountInfo(mintKey, 'finalized');
  if (!mintInfo || (!mintInfo.owner.equals(TOKEN_PROGRAM_ID) && !mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) || mintInfo.data.length < 45) throw new Error('Verified launch mint account is unavailable.');
  const decimals = mintInfo.data[44];
  if (decimals > 9 || !Number.isSafeInteger(reservedTokens) || reservedTokens <= 0) throw new Error('Invalid community reserve parameters.');
  const required = BigInt(reservedTokens) * 10n ** BigInt(decimals);
  const { vault } = rewardAddresses({ programId:program, authority:issuer, mint:mintKey });
  const vaultInfo = await connection.getAccountInfo(vault, 'finalized');
  if (!vaultInfo) return { mint:mintKey.toBase58(), status:'unfunded', verified:false, vaultInitialized:false, reservedTokens, fundedTokens:'0', vault:vault.toBase58() };
  const data = Buffer.from(vaultInfo.data);
  if (!vaultInfo.owner.equals(program) || data.length < 73 || !data.subarray(0, 8).equals(vaultDiscriminator)
    || !new PublicKey(data.subarray(8, 40)).equals(issuer) || !new PublicKey(data.subarray(40, 72)).equals(mintKey)) throw new Error('Community vault account failed on-chain verification.');
  const tokenAccount = getAssociatedTokenAddressSync(mintKey, vault, true, mintInfo.owner);
  const tokenInfo = await connection.getAccountInfo(tokenAccount, 'finalized');
  if (!tokenInfo) return { mint:mintKey.toBase58(), status:'unfunded', verified:false, vaultInitialized:true, reservedTokens, fundedTokens:'0', vault:vault.toBase58() };
  const tokenData = Buffer.from(tokenInfo.data);
  if (!tokenInfo.owner.equals(mintInfo.owner) || tokenData.length < 109 || tokenData[108] === 0
    || !new PublicKey(tokenData.subarray(0, 32)).equals(mintKey) || !new PublicKey(tokenData.subarray(32, 64)).equals(vault)) throw new Error('Community vault token account failed on-chain verification.');
  const balance = tokenData.readBigUInt64LE(64);
  let receiptVerified = false;
  if (balance >= required && fundingSignature) {
    const [status, transaction] = await Promise.all([
      connection.getSignatureStatus(fundingSignature, { searchTransactionHistory:true }),
      connection.getTransaction(fundingSignature, { commitment:'finalized', maxSupportedTransactionVersion:0 }),
    ]);
    if (status?.value?.confirmationStatus === 'finalized' && !status.value.err && transaction?.meta && !transaction.meta.err) {
      const keys = transaction.transaction.message.accountKeys.map(key => new PublicKey(key.pubkey || key));
      const source = getAssociatedTokenAddressSync(mintKey, funder, false, mintInfo.owner);
      const sourceIndex = keys.findIndex(key => key.equals(source));
      const destinationIndex = keys.findIndex(key => key.equals(tokenAccount));
      const signer = keys.slice(0, transaction.transaction.message.header.numRequiredSignatures).some(key => key.equals(funder));
      const tokenAmount = (rows, index) => BigInt(rows?.find(row => row.accountIndex === index && row.mint === mintKey.toBase58())?.uiTokenAmount?.amount || '0');
      const sourceDelta = tokenAmount(transaction.meta.postTokenBalances, sourceIndex) - tokenAmount(transaction.meta.preTokenBalances, sourceIndex);
      const destinationDelta = tokenAmount(transaction.meta.postTokenBalances, destinationIndex) - tokenAmount(transaction.meta.preTokenBalances, destinationIndex);
      receiptVerified = signer && sourceIndex >= 0 && destinationIndex >= 0 && sourceDelta === -required && destinationDelta === required;
    }
  }
  return {
    mint:mintKey.toBase58(), status:balance >= required ? receiptVerified ? 'funded' : 'funding-unverified' : balance > 0n ? 'partial' : 'unfunded',
    verified:receiptVerified, vaultInitialized:true, reservedTokens, fundedTokens:String(balance / 10n ** BigInt(decimals)),
    vault:vault.toBase58(), tokenAccount:tokenAccount.toBase58(),
    fundingSignature:receiptVerified ? fundingSignature : null,
  };
}
