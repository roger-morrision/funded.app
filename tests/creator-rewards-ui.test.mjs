import test from 'node:test';
import assert from 'node:assert/strict';
import { createCreatorFeesController } from '../src/app/controllers/creator-fees.js';
import { creatorRewardRow, filterCreatorRewards, verifiedV3CreatorLaunch } from '../creator-reward-model.js';

const launch = { mint:'mint-a', symbol:'ALPHA', creatorWallet:'creator', creator:'router',
  cluster:'devnet', onchainVerified:true,
  pumpFeeRoute:{scope:'per-mint-v3', router:'router', programId:'v3-program'} };
const overview = { available:true, scope:'per-mint-v3', creatorWallet:'creator',
  gates:{ settlement:true, communityFunding:true, creatorRewardFunding:true, creatorWalletPayout:true },
  collections:[{ signature:'collection-signature', amountLamports:'10000000', settlement:'pending' }] };

function element(tag = 'div') {
  return { tag, children:[], hidden:false, disabled:false, textContent:'',
    append(...items) { this.children.push(...items); },
    replaceChildren() { this.children=[]; } };
}
function fixture({ switched = false, reject = false, prepared = true } = {}) {
  const root = element(), calls = [], messages = [];
  const transaction = { serialize:() => new Uint8Array([1, 2]) };
  let walletChanged = false;
  const session = { address:'creator', provider:{
    async signTransaction() { if (reject) throw new Error('Signing rejected'); walletChanged = switched; return transaction; },
  } };
  const state = {
    connectedWalletAddress:'creator', wallet:session.provider, currentCoinFeeOverview:overview,
    creatorClaimsInFlight:new Set(), getCoinMintAddress:() => 'mint-a',
    renderCoinSummary() {}, coinFeeSol:value => `${value} lamports`,
    captureWalletSession:() => session,
    assertWalletSessionCurrent:() => { if (walletChanged) throw new Error('Wallet changed'); },
    showToast:value => messages.push(value),
    getSolana:async () => ({ Transaction:{ from:() => transaction } }),
    base64ToBytes:() => new Uint8Array([1]), bytesToBase64:() => 'signed-transaction',
    apiRequest:async (path, options = {}) => {
      calls.push({ path, signed:Boolean(options.body?.creatorSignedTransaction) });
      if (path.endsWith('/fee-activity')) return { available:true, data:{ mint:'mint-a', overview } };
      if (!prepared) return { available:false, data:null };
      return options.body?.creatorSignedTransaction
        ? { available:true, data:{ status:'finalized', signature:'finalized-signature' } }
        : { available:true, data:{ status:'awaiting-creator-signature', mint:'mint-a',
          collectionSignature:'collection-signature', creatorWallet:'creator',
          recipient:'reward-vault', transaction:'prepared-transaction' } };
    },
  };
  const controller = createCreatorFeesController(state);
  state.renderCoinFeeDashboard = controller.renderCoinFeeDashboard;
  const previousDocument = globalThis.document;
  globalThis.document = { querySelector:() => root, createElement:element };
  return { root, calls, messages, state, controller, restore:() => { globalThis.document = previousDocument; } };
}

test('V2 creator claim panel has no active signing controls', () => {
  const f = fixture();
  try {
    f.controller.renderCoinFeeDashboard({ available:true, scope:'per-mint-v2', creatorWallet:'creator' });
    assert.equal(f.root.hidden, true);
    assert.equal(f.root.children.length, 0);
  } finally { f.restore(); }
});

test('verified V3 collection shows settlement to owner and funding after finalization', () => {
  const f = fixture();
  try {
    f.controller.renderCoinFeeDashboard(overview);
    assert.equal(f.root.hidden, false);
    assert.equal(f.root.children[0].children[1].textContent, 'Approve V3 settlement');
    assert.equal(f.root.children[0].children[1].disabled, false);
    const settled = { ...overview, collections:[{ ...overview.collections[0], settlement:'finalized',
      allocationPlan:{ status:'allocated-not-funded', protocol:{ communityLamports:'100', buybackLamports:'50' },
        creatorDirected:{ holderLamports:'200', xLamports:'0', walletLamports:'300' } } }] };
    f.controller.renderCoinFeeDashboard(settled);
    assert.equal(f.root.children[0].children.length, 4);
    assert.equal(f.root.children[0].children[1].textContent, 'Fund community allocation');
    assert.doesNotMatch(f.root.children[0].children.map(row=>row.textContent).join(' '),/Buy back and burn/);
    f.state.connectedWalletAddress = 'other-wallet';
    f.controller.renderCoinFeeDashboard(settled);
    assert.equal(f.root.hidden, true);
  } finally { f.restore(); }
});

test('V3 settlement signs once and accepts only finalized result', async () => {
  const f = fixture();
  try {
    await f.controller.requestV3FeeAction({ isConnected:true, textContent:'Approve', disabled:false },
      'settlement', 'collection-signature');
    assert.deepEqual(f.calls.map(row => row.path), [
      '/api/tokens/mint-a/v3-settlement/collection-signature',
      '/api/tokens/mint-a/v3-settlement/collection-signature',
      '/api/tokens/mint-a/fee-activity']);
    assert.equal(f.calls[1].signed, true);
    assert.match(f.messages.at(-1), /finalized on Devnet/);
    assert.equal(f.state.creatorClaimsInFlight.size, 0);
  } finally { f.restore(); }
});

test('V3 funding stops on wallet change, signature rejection, or missing preparation', async () => {
  for (const options of [{ switched:true }, { reject:true }, { prepared:false }]) {
    const f = fixture(options);
    try {
      await f.controller.requestV3FeeAction({ isConnected:true, textContent:'Fund', disabled:false },
        'community-funding', 'collection-signature');
      assert.equal(f.calls.filter(row => row.signed).length, 0);
      assert.equal(f.state.creatorClaimsInFlight.size, 0);
      assert.match(f.messages.at(-1), /Wallet changed|Signing rejected|review is unavailable/);
    } finally { f.restore(); }
  }
});

test('creator reward filters retain pending balances and search identifiers', () => {
  const rows = [
    {name:'OLD',fullName:'Past launch',mint:'mint-old',unclaimed:0n,available:0n,ready:false},
    {name:'WAIT',fullName:'Pending launch',mint:'mint-wait',unclaimed:10n,available:0n,ready:false},
    {name:'NEW',fullName:'Current launch',mint:'mint-new',unclaimed:20n,available:20n,ready:true},
  ];
  assert.deepEqual(filterCreatorRewards(rows).map(row => row.name), ['NEW','WAIT']);
  assert.equal(filterCreatorRewards(rows,{filter:'all'}).length,3);
  for (const query of [' past ', 'OLD', 'mint-old'])
    assert.equal(filterCreatorRewards(rows,{filter:'all',query})[0].name,'OLD');
  assert.equal(rows[0].name,'OLD');
});

test('creator rewards use only verified V3 settlements and payout records', () => {
  const allocation = {status:'allocated-not-funded',mint:'mint-a',programId:'v3-program',
    sourceCollectionSignature:'source-1',creatorDirected:{walletLamports:'10000000'}};
  const activity = {mint:'mint-a',cluster:'devnet',overview:{available:true,scope:'per-mint-v3',
    creatorWallet:'creator',gates:{creatorWalletPayout:true},collections:[
      {signature:'source-1',settlement:'finalized',creatorWalletPayout:'pending',allocationPlan:allocation},
      {signature:'source-2',settlement:'pending'},
    ]}};
  assert.equal(verifiedV3CreatorLaunch(launch,'creator','devnet'),true);
  assert.equal(verifiedV3CreatorLaunch({...launch,pumpFeeRoute:{...launch.pumpFeeRoute,scope:'per-mint-v2'}},'creator','devnet'),false);
  const pending=creatorRewardRow(launch,activity,'creator','devnet');
  assert.equal(pending.ready,true);
  assert.equal(pending.unclaimed,10000000n);
  assert.equal(pending.pendingSettlementCount,1);
  activity.overview.collections[0].creatorWalletPayout='finalized';
  assert.equal(creatorRewardRow(launch,activity,'creator','devnet').paid,0n);
  activity.overview.collections[0].creatorWalletPayoutVerified=true;
  const paid=creatorRewardRow(launch,activity,'creator','devnet');
  assert.equal(paid.paid,10000000n);
  assert.equal(paid.unclaimed,0n);
  assert.equal(paid.ready,false);
  activity.overview.collections[0].allocationPlan={...allocation,programId:'retired-v2'};
  assert.throws(() => creatorRewardRow(launch,activity,'creator','devnet'),/V3 creator allocation/);
  activity.overview.collections[0].allocationPlan=allocation;
  assert.throws(() => creatorRewardRow(launch,{...activity,mint:'other'},'creator','devnet'));
  assert.throws(() => creatorRewardRow(launch,activity,'other','devnet'));
});
