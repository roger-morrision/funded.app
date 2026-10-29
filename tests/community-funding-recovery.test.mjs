import test from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';
import { createCommunityClaimsController } from '../src/app/controllers/community-claims.js';
import { readPendingCommunityFunding, savePendingCommunityFunding, clearPendingCommunityFunding } from '../community-funding-recovery.js';

const mint = Keypair.generate().publicKey.toBase58();
const wallet = Keypair.generate().publicKey.toBase58();
const signature = bs58.encode(new Uint8Array(64).fill(7));
const pending = { mint, wallet, signature, cluster:'devnet' };

function storage() {
  const items = new Map();
  return { getItem:key => items.get(key) ?? null, setItem:(key, value) => items.set(key, value),
    removeItem:key => items.delete(key) };
}

test('reserve transfer identity is saved before broadcast and cannot be replaced or cleared by another transfer', () => {
  const saved = storage();
  assert.equal(readPendingCommunityFunding(saved), null);
  assert.deepEqual(savePendingCommunityFunding(pending, saved), pending);
  assert.deepEqual(readPendingCommunityFunding(saved), pending);
  assert.throws(() => savePendingCommunityFunding({ ...pending, signature:bs58.encode(new Uint8Array(64).fill(8)) }, saved), /Another signed reserve transfer/);
  assert.throws(() => clearPendingCommunityFunding({ ...pending, mint:Keypair.generate().publicKey.toBase58() }, saved), /different reserve transfer/);
  assert.deepEqual(readPendingCommunityFunding(saved), pending);
  clearPendingCommunityFunding(pending, saved);
  assert.equal(readPendingCommunityFunding(saved), null);
});

async function recover(statusRow) {
  const saved = storage();
  savePendingCommunityFunding(pending, saved);
  const messages = [], links = [], button = { disabled:false, textContent:'Fund reserve' };
  const status = { dataset:{}, append:(...nodes) => { for (const node of nodes) {
    if (node.tag === 'a') links.push(node); else messages.push(node.textContent);
  } } };
  const priorDocument = globalThis.document;
  globalThis.document = {
    querySelector:selector => selector === '[data-fund-community-mint]' ? button : status,
    createTextNode:text => ({ textContent:text }),
    createElement:tag => ({ tag }),
  };
  let signs = 0, receiptPosts = 0, refreshes = 0;
  const session = { address:wallet, provider:{ signTransaction:async () => { signs++; } } };
  const appState = {
    captureWalletSession:() => session, canSignTransactions:() => true,
    readPendingCommunityFunding:() => readPendingCommunityFunding(saved),
    savePendingCommunityFunding:value => savePendingCommunityFunding(value, saved),
    clearPendingCommunityFunding:value => clearPendingCommunityFunding(value, saved),
    getTradePreviewConnection:async () => ({ getSignatureStatuses:async () => ({ value:[statusRow] }) }),
    apiRequest:async () => { receiptPosts++; return { available:true, data:{ verified:true } }; },
    isWalletSessionCurrent:() => true,
    loadCommunityReserveStatuses:async () => { refreshes++; },
    getAirdropPrograms:() => [], renderAirdropProgramDetail:() => {}, showToast:() => {},
    communityFundingPreview:null, APP_EXPLORER_QUERY:'?cluster=devnet',
  };
  try { await createCommunityClaimsController(appState).fundCommunityReserve(mint); }
  finally { globalThis.document = priorDocument; }
  return { messages:messages.join(' '), links, button, signs, receiptPosts, refreshes,
    saved:readPendingCommunityFunding(saved) };
}

test('an unresolved reserve transfer stays saved and a retry never asks the wallet to sign', async () => {
  const result = await recover(null);
  assert.equal(result.signs, 0);
  assert.equal(result.receiptPosts, 0);
  assert.deepEqual(result.saved, pending);
  assert.equal(result.button.textContent, 'Check transfer status');
  assert.match(result.messages, /status needs verification.*before signing another transfer/);
  assert.equal(result.links[0]?.href, `https://explorer.solana.com/tx/${signature}?cluster=devnet`);
});

test('a finalized failed reserve transfer clears recovery and reports failure', async () => {
  const result = await recover({ err:{ InstructionError:[0, 'Custom'] }, confirmationStatus:'finalized' });
  assert.equal(result.signs, 0);
  assert.equal(result.saved, null);
  assert.equal(result.button.textContent, 'Review reserve funding');
  assert.match(result.messages, /Funding failed on Solana.*No reserve tokens were transferred/);
});

test('a finalized reserve transfer requires server receipt proof before clearing recovery', async () => {
  const result = await recover({ err:null, confirmationStatus:'finalized' });
  assert.equal(result.signs, 0);
  assert.equal(result.receiptPosts, 1);
  assert.equal(result.refreshes, 1);
  assert.equal(result.saved, null);
});
