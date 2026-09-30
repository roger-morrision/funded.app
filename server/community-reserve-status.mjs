import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import { rewardAddresses } from './automatic-reward-chain.mjs';
import { communityAddresses } from './community-claim-chain.mjs';

const vaultDiscriminator = createHash('sha256').update('account:RewardVault').digest().subarray(0, 8);
const dropDiscriminator = createHash('sha256').update('account:CommunityDrop').digest().subarray(0, 8);
const openingDiscriminator = createHash('sha256').update('global:initialize_community_drop_from_reward_vault').digest().subarray(0, 8);

function transactionKeys(transaction) {
  const message = transaction.transaction.message;
  const staticKeys = message.accountKeys || message.staticAccountKeys || [];
  const loaded = transaction.meta?.loadedAddresses;
  const keys = [...staticKeys, ...(loaded?.writable || []), ...(loaded?.readonly || [])]
    .map(key => new PublicKey(key.pubkey || key));
  if (message.addressTableLookups?.length && (!loaded || keys.length === staticKeys.length))
    throw new Error('CommunityDrop opening receipt has unresolved address lookups.');
  return keys;
}

async function verifiedDrop({ connection, program, issuer, funder, mintKey, tokenProgram, sourceVault, sourceTokenAccount,
  required, expectedEligibilityMint, dropOpeningSignature }) {
  const { drop } = communityAddresses({ programId:program, authority:issuer, mint:mintKey });
  const info = await connection.getAccountInfo(drop, 'finalized');
  if (!info) return null;
  const data = Buffer.from(info.data || []);
  if (!info.owner.equals(program) || data.length < 350 || !data.subarray(0, 8).equals(dropDiscriminator)
    || !new PublicKey(data.subarray(8, 40)).equals(issuer)
    || !new PublicKey(data.subarray(40, 72)).equals(funder)
    || !new PublicKey(data.subarray(72, 104)).equals(issuer)
    || !new PublicKey(data.subarray(104, 136)).equals(mintKey)
    || (expectedEligibilityMint && !new PublicKey(data.subarray(136, 168)).equals(new PublicKey(expectedEligibilityMint)))) {
    throw new Error('CommunityDrop account failed on-chain ownership or policy verification.');
  }
  const root = data.subarray(168, 200).toString('hex'), snapshotHash = data.subarray(200, 232).toString('hex');
  const migrationSlot = Number(data.readBigUInt64LE(296)), snapshotSlot = Number(data.readBigUInt64LE(304));
  const total = data.readBigUInt64LE(312), claimed = data.readBigUInt64LE(320), leafCount = data.readUInt32LE(344), closed = data[348] !== 0;
  const migrationAt = Number(data.readBigInt64LE(328)), expiresAt = Number(data.readBigInt64LE(336));
  const destination = getAssociatedTokenAddressSync(mintKey, drop, true, tokenProgram);
  const destinationInfo = await connection.getAccountInfo(destination, 'finalized');
  if (!destinationInfo || !destinationInfo.owner.equals(tokenProgram) || destinationInfo.data.length < 109
    || !new PublicKey(destinationInfo.data.subarray(0, 32)).equals(mintKey)
    || !new PublicKey(destinationInfo.data.subarray(32, 64)).equals(drop)
    || destinationInfo.data[108] === 0) throw new Error('CommunityDrop token vault failed on-chain verification.');
  const remaining = destinationInfo.data.readBigUInt64LE(64);
  if (total !== required || claimed > total || (closed ? remaining !== 0n : remaining + claimed !== total) || migrationSlot <= 0
    || migrationSlot !== snapshotSlot || root === '00'.repeat(32) || snapshotHash === '00'.repeat(32)) {
    throw new Error('CommunityDrop allocation, migration slot, or claim-vault balance is inconsistent.');
  }
  let receiptVerified = false;
  if (dropOpeningSignature) {
    const [status, transaction] = await Promise.all([
      connection.getSignatureStatus(dropOpeningSignature, { searchTransactionHistory:true }),
      connection.getTransaction(dropOpeningSignature, { commitment:'finalized', maxSupportedTransactionVersion:0 }),
    ]);
    if (status?.value?.confirmationStatus === 'finalized' && !status.value.err && transaction?.meta && !transaction.meta.err) {
      const message = transaction.transaction.message;
      const keys = transactionKeys(transaction);
      const sourceIndex = keys.findIndex(key => key.equals(sourceTokenAccount));
      const destinationIndex = keys.findIndex(key => key.equals(destination));
      const tokenAmount = (rows, index) => BigInt(rows?.find(row => row.accountIndex === index && row.mint === mintKey.toBase58())?.uiTokenAmount?.amount || '0');
      const sourceBefore = tokenAmount(transaction.meta.preTokenBalances, sourceIndex);
      const sourceAfter = tokenAmount(transaction.meta.postTokenBalances, sourceIndex);
      const destinationBefore = tokenAmount(transaction.meta.preTokenBalances, destinationIndex);
      const destinationAfter = tokenAmount(transaction.meta.postTokenBalances, destinationIndex);
      const ix = (message.instructions || message.compiledInstructions || []).find(instruction => {
        const instructionProgram = keys[instruction.programIdIndex];
        const accounts = instruction.accounts;
        if (!instructionProgram?.equals(program) || !Array.isArray(accounts) || accounts.length < 13
          || !keys[accounts[0]]?.equals(issuer) || !keys[accounts[1]]?.equals(funder)
          || !keys[accounts[3]]?.equals(mintKey)
          || !expectedEligibilityMint || !keys[accounts[4]]?.equals(new PublicKey(expectedEligibilityMint))
          || !keys[accounts[5]]?.equals(sourceVault) || !keys[accounts[6]]?.equals(sourceTokenAccount)
          || !keys[accounts[7]]?.equals(drop) || !keys[accounts[8]]?.equals(destination)) return false;
        try { return Buffer.from(bs58.decode(instruction.data)).subarray(0, 8).equals(openingDiscriminator); }
        catch { return false; }
      });
      receiptVerified = Boolean(ix) && transaction.slot >= migrationSlot
        && sourceIndex >= 0 && destinationIndex >= 0
        && keys.some(key => key.equals(sourceVault)) && keys.some(key => key.equals(drop))
        && sourceBefore === required && sourceAfter === 0n
        && destinationBefore === 0n && destinationAfter === required;
    }
  }
  return { status:receiptVerified ? closed ? 'drop-closed' : 'drop-active' : 'funding-unverified', verified:receiptVerified,
    drop:drop.toBase58(), dropTokenAccount:destination.toBase58(), dropOpeningSignature:receiptVerified ? dropOpeningSignature : null,
    merkleRoot:receiptVerified ? root : null, snapshotHash:receiptVerified ? snapshotHash : null,
    migrationSlot, snapshotSlot, migrationAt, expiresAt, leafCount,
    totalBaseUnits:String(total), claimedBaseUnits:String(claimed), remainingBaseUnits:String(remaining),
    sourceVault:sourceVault.toBase58() };
}

export async function readCommunityReserveStatus({ connection, programId, authority, fundingAuthority = authority, mint, reservedTokens,
  fundingSignature = null, expectedEligibilityMint = null, dropOpeningSignature = null }) {
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
  if (balance < required) {
    const drop = await verifiedDrop({ connection, program, issuer, funder, mintKey, tokenProgram:mintInfo.owner,
      sourceVault:vault, sourceTokenAccount:tokenAccount, required, expectedEligibilityMint, dropOpeningSignature });
    if (drop) return { mint:mintKey.toBase58(), ...drop, vault:vault.toBase58(), vaultInitialized:true,
      reservedTokens, fundedTokens:drop.verified ? String(required / 10n ** BigInt(decimals)) : String(balance / 10n ** BigInt(decimals)),
      tokenAccount:tokenAccount.toBase58(),
      fundingSignature:null };
  }
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
