import test from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';
import { createCommunityClaimsController } from '../src/app/controllers/community-claims.js';
import { readPendingCommunityClaim, savePendingCommunityClaim,
  clearPendingCommunityClaim } from '../community-claim-recovery.js';

const mint = Keypair.generate().publicKey.toBase58();
const wallet = Keypair.generate().publicKey.toBase58();
const signature = bs58.encode(new Uint8Array(64).fill(9));
const pending = { mint, wallet, signature, cluster:'devnet' };

function storage() {
  const items = new Map();
  return { getItem:key => items.get(key) ?? null, setItem:(key, value) => items.set(key, value),
    removeItem:key => items.delete(key) };
}

test('saved community claims cannot be replaced or cleared by another signed claim', () => {
  const saved = storage();
  savePendingCommunityClaim(pending, saved);
  assert.deepEqual(readPendingCommunityClaim(saved), pending);
  assert.throws(() => savePendingCommunityClaim({ ...pending, signature:bs58.encode(new Uint8Array(64).fill(8)) }, saved), /Another signed community claim/);
  assert.throws(() => clearPendingCommunityClaim({ ...pending, mint:Keypair.generate().publicKey.toBase58() }, saved), /different community claim/);
  assert.deepEqual(readPendingCommunityClaim(saved), pending);
  clearPendingCommunityClaim(pending, saved);
  assert.equal(readPendingCommunityClaim(saved), null);
});

async function recover(receipt, proof) {
  const saved = storage();
  savePendingCommunityClaim(pending, saved);
  const nodes = [], updates = [];
  const status = { dataset:{ mint }, append:(...items) => nodes.push(...items) };
  const priorDocument = globalThis.document;
  globalThis.document = { querySelector:() => status, createElement:tag => ({ tag, dataset:{} }),
    createTextNode:text => ({ textContent:text }) };
  let signs = 0, proofReads = 0;
  const session = { address:wallet, provider:{ signTransaction:async () => { signs++; } } };
  const program = { id:mint, claimActive:true, snapshotHash:'snapshot' };
  const appState = {
    wallet:session.provider, captureWalletSession:() => session, canSignTransactions:() => true,
    getAirdropPrograms:() => [program], communityWalletAllocations:new Map(),
    readPendingCommunityClaim:() => readPendingCommunityClaim(saved),
    savePendingCommunityClaim:value => savePendingCommunityClaim(value, saved),
    clearPendingCommunityClaim:value => clearPendingCommunityClaim(value, saved),
    getTradePreviewConnection:async () => ({ getSignatureStatuses:async () => ({ value:[receipt] }) }),
    apiRequest:async () => { proofReads++; return { available:true, data:proof }; },
    isWalletSessionCurrent:() => true, updateDirectoryWalletAmount:(...args) => updates.push(args),
    APP_EXPLORER_QUERY:'?cluster=devnet',
  };
  const controller = createCommunityClaimsController(appState);
  appState.appendPendingCommunityClaim = controller.appendPendingCommunityClaim;
  try {
    await controller.submitCommunityClaim(mint);
    await controller.checkCommunityClaim(mint);
  } finally { globalThis.document = priorDocument; }
  return { nodes, updates, signs, proofReads, saved:readPendingCommunityClaim(saved) };
}

test('a pending claim survives reload and blocks another wallet signature', async () => {
  const result = await recover(null, { status:'claimable' });
  assert.equal(result.signs, 0);
  assert.equal(result.proofReads, 0);
  assert.deepEqual(result.saved, pending);
  assert.equal(result.nodes.find(node => node.tag === 'a')?.href,
    `https://explorer.solana.com/tx/${signature}?cluster=devnet`);
});

test('finalized claim waits for server claimed proof before recovery clears', async () => {
  const result = await recover({ err:null, confirmationStatus:'finalized' }, { status:'claimable' });
  assert.equal(result.signs, 0);
  assert.equal(result.proofReads, 1);
  assert.deepEqual(result.saved, pending);
  assert.match(result.nodes.map(node => node.textContent || '').join(' '), /allocation receipt is not verified yet/);
});

test('finalized claimed proof clears recovery and reports the wallet claimed', async () => {
  const result = await recover({ err:null, confirmationStatus:'finalized' },
    { status:'claimed', mint, recipient:wallet, amount:'unavailable' });
  assert.equal(result.signs, 0);
  assert.equal(result.proofReads, 1);
  assert.equal(result.saved, null);
  assert.ok(result.updates.some(row => row[2] === 'claimed'));
});

test('a finalized failed claim clears recovery before checking eligibility again', async () => {
  const result = await recover({ err:{ InstructionError:[0, 'Custom'] }, confirmationStatus:'finalized' },
    { status:'ineligible', reason:'No allocation' });
  assert.equal(result.signs, 0);
  assert.equal(result.proofReads, 1);
  assert.equal(result.saved, null);
  assert.match(result.nodes.map(node => node.textContent || '').join(' '), /original claim failed on Solana/);
});
