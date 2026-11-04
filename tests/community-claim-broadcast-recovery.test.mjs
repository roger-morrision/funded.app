import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import bs58 from 'bs58';
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';
import { createCommunityClaimsController } from '../src/app/controllers/community-claims.js';
import { readPendingCommunityClaim, savePendingCommunityClaim,
  clearPendingCommunityClaim } from '../community-claim-recovery.js';

test('claim broadcast timeout keeps the signed signature and a verification action', async () => {
  const wallet = Keypair.generate(), mint = Keypair.generate().publicKey, program = Keypair.generate().publicKey;
  const authority = Keypair.generate().publicKey;
  const [drop] = PublicKey.findProgramAddressSync([Buffer.from('community-drop-v1'), authority.toBuffer(), mint.toBuffer()], program);
  const [payment] = PublicKey.findProgramAddressSync([Buffer.from('community-pay-v1'), drop.toBuffer(), wallet.publicKey.toBuffer()], program);
  const vaultToken = getAssociatedTokenAddressSync(mint, drop, true, TOKEN_PROGRAM_ID);
  const recipientToken = getAssociatedTokenAddressSync(mint, wallet.publicKey, false, TOKEN_PROGRAM_ID);
  const keys = [wallet.publicKey, drop, wallet.publicKey, mint, vaultToken, recipientToken, payment,
    TOKEN_PROGRAM_ID, SystemProgram.programId];
  const accounts = keys.map((key, index) => ({ pubkey:key.toBase58(), isSigner:index === 0, isWritable:index < 7 }));
  const data = Buffer.alloc(24);
  createHash('sha256').update('global:claim_community_drop').digest().copy(data, 0, 0, 8);
  data.writeBigUInt64LE(5n, 8);
  const dropData = Buffer.alloc(350);
  authority.toBuffer().copy(dropData, 8);
  const nodes = [], button = { disabled:false };
  const status = { querySelector:() => button, append:(...items) => nodes.push(...items) };
  const priorDocument = globalThis.document;
  const items = new Map();
  const storage = { getItem:key => items.get(key) ?? null, setItem:(key, value) => items.set(key, value),
    removeItem:key => items.delete(key) };
  globalThis.document = { querySelector:() => status,
    createElement:tag => ({ tag, dataset:{} }), createTextNode:text => ({ textContent:text }) };
  let signedSignature = '', sendCount = 0;
  const provider = { publicKey:wallet.publicKey, signTransaction:async transaction => {
    transaction.partialSign(wallet);
    signedSignature = bs58.encode(transaction.signature);
    return transaction;
  } };
  const session = { address:wallet.publicKey.toBase58(), provider };
  const rpc = {
    getAccountInfo:async key => key.equals(mint) ? { owner:TOKEN_PROGRAM_ID, data:Buffer.alloc(82) }
      : key.equals(drop) ? { owner:program, data:dropData } : null,
    getTokenAccountBalance:async () => ({ value:{ amount:'0' } }),
    getLatestBlockhash:async () => ({ blockhash:Keypair.generate().publicKey.toBase58(), lastValidBlockHeight:100 }),
    sendRawTransaction:async () => { sendCount++; throw new Error('network timeout after broadcast'); },
  };
  const appState = {
    captureWalletSession:() => session, canSignTransactions:() => true,
    readPendingCommunityClaim:() => readPendingCommunityClaim(storage),
    savePendingCommunityClaim:value => savePendingCommunityClaim(value, storage),
    clearPendingCommunityClaim:value => clearPendingCommunityClaim(value, storage),
    communityClaimReview:{ mint:mint.toBase58(), wallet:session.address, amount:'5', index:0, at:Date.now() },
    apiRequest:async () => ({ available:true, data:{ accounts, amount:'5', programId:program.toBase58(),
      data:data.toString('base64'), recipientToken:recipientToken.toBase58() } }),
    getSolana:async () => ({ PublicKey, Transaction, TransactionInstruction, getAssociatedTokenAddressSync,
      createAssociatedTokenAccountIdempotentInstruction, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID }),
    getTradePreviewConnection:async () => rpc,
    verifiedCommunityReserves:new Map([[mint.toBase58(), { verified:true, programId:program.toBase58(),
      scope:'per-mint-v3', drop:drop.toBase58() }]]),
    verifiedLaunchPolicies:[{ mint:mint.toBase58(), cluster:'devnet', onchainVerified:true,
      pumpFeeRoute:{ scope:'per-mint-v3', verified:true, programId:program.toBase58() } }],
    Buffer, bs58, APP_EXPLORER_QUERY:'?cluster=devnet',
    assertWalletSessionCurrent:() => {}, isWalletSessionCurrent:() => true,
    emitPilotSignal:() => {}, pilotInterruptedSignal:() => 'claim-interrupted',
  };
  const controller = createCommunityClaimsController(appState);
  appState.appendPendingCommunityClaim = controller.appendPendingCommunityClaim;
  try { await controller.submitCommunityClaim(mint.toBase58()); }
  finally { globalThis.document = priorDocument; }
  assert.equal(sendCount, 1);
  assert.equal(readPendingCommunityClaim(storage)?.signature, signedSignature);
  assert.equal(button.disabled, true);
  assert.equal(nodes.find(node => node.tag === 'a')?.href,
    `https://explorer.solana.com/tx/${signedSignature}?cluster=devnet`);
  assert.match(nodes.map(node => node.textContent || '').join(' '), /submitted.*Check its status before trying again/);
});
