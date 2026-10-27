import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderWalletDetail} from '../src/features/portfolio/wallet-detail-view.js';

const address='ER7zhtSwfSu7B5Wb7uFwnWSZPLMmezmSXieY5JyLFzXC';
function node(dataset={}) { return {dataset,hidden:false,textContent:'',innerHTML:'',attrs:{},children:[],classList:{toggle(){}},setAttribute(k,v){this.attrs[k]=v;},append(e){this.children.push(e);}}; }
export function fixture(options={},render=renderWalletDetail) {
  const tabs=['activity','balances','created'].map(walletTab=>node({walletTab})),filters=['all','buy','sell','launch','burn','claim','reward','airdrop','bonus'].map(walletFilter=>node({walletFilter}));
  const nodes=Object.fromEntries(['page','page-title','page-address','self-badge','edit-profile','follow','stat-sol','stat-sol-note','stat-launches','stat-trades','stat-trades-note','stat-volume','stat-volume-note','stat-burned','stat-last','detail-description','detail-content','detail-filters'].map(k=>['#wallet-'+k,node()]));
  nodes['#wallet-detail-filters'].querySelectorAll=()=>filters;
  const document={querySelector:s=>nodes[s],querySelectorAll:()=>tabs,createElement:()=>node()};
  const state={connectedWalletAddress:options.self?address:'',portfolioTradeHistory:options.direct?{wallet:address,...options.direct}:null,verifiedLaunchPoliciesStatus:options.registry||'ready',exploreScannedCount:options.scanned??5,assets:Array(18).fill({}),exploreProviderStatus:options.stale?'stale':'ready',walletBalanceLamports:1250000000,coinSolUsdPrice:100,walletDetailTab:options.tab||'activity',walletDetailFilter:options.filter||'buy',walletHistory:{wallet:address,status:'ready',rows:options.historyRows||[],coverage:options.historyCoverage||{}},fundedBurnState:{}};
  const deps={document,getWalletDetailAddress:()=>address,walletDetailLaunches:()=>options.launches||[],walletDetailTrades:()=>options.trades||[],walletDetailBurned:()=>0,walletLaunchTimestamp:l=>l.time||0,validateSolanaMint:()=>({valid:true}),getFollowedWallets:()=>[{address}],formatSol:n=>n/1e9+' SOL',formatOnchainAge:()=> '1m ago',walletDetailEmpty:(title,detail)=>JSON.stringify({title,detail}),loadWalletRowLogos:()=>{},exploreExplorer:p=>'https://explorer.solana.com/'+p+'?cluster=devnet'};
  render(state,deps);
  const text=k=>nodes['#wallet-'+k].textContent,content=nodes['#wallet-detail-content'].innerHTML;
  return {nodes,state,deps,filters,tabs,text,content,empty:content.startsWith('{')?JSON.parse(content):null};
}

test('public partial BUY/SELL/ALL empty records carry adjacent applicable scope and observed zero',()=>{
  for(const [filter,detail] of [['buy','No buys were found in the available 24-hour trade records.'],['sell','No sells were found in the available 24-hour trade records.'],['all','No matching activity was found in the available public records.']]) {
    const f=fixture({filter});assert.deepEqual(f.empty,{title:'No matching activity',detail:detail+' Trades shown for 5 of 18 listed coins.'});
    assert.equal(f.text('stat-volume'),'$0.00');assert.equal(f.text('stat-trades'),'0');assert.equal(f.text('stat-volume-note'),'No trades observed in available 24-hour records. Trades shown for 5 of 18 listed coins.');
    assert.equal(f.text('stat-sol'),'—');assert.equal(f.text('stat-sol-note'),'Shown only for your connected wallet.');assert.equal(f.nodes['#wallet-follow'].textContent,'Following ✓');
    assert.deepEqual(f.filters.filter(n=>n.attrs['aria-pressed']==='true').map(n=>n.dataset.walletFilter),[filter]);
  }
});
test('complete and stale listed scans retain 24-hour scope without implying all-chain completeness',()=>{
  const complete=fixture({scanned:18});assert.equal(complete.empty.detail,'No buys were found in the available 24-hour trade records.');assert.equal(complete.text('stat-volume-note'),'No trades observed in available 24-hour records.');
  for(const scanned of [5,18]){const f=fixture({scanned,stale:true});assert(f.empty.detail.endsWith(`Trades shown for ${scanned} of 18 listed coins (last available update).`));assert(f.text('stat-volume-note').includes('(last available update)'));assert.equal(f.text('stat-volume'),'$0.00');}
});
test('direct ready partial uses its own note; direct complete ignores unrelated Explore stale state',()=>{
  const partial=fixture({direct:{status:'ready',coverage:'partial',scannedSignatures:50},stale:true,scanned:0});assert(partial.empty.detail.endsWith('50 wallet transactions checked · partial Pump/PumpSwap history.'));assert(!partial.content.includes('listed coins'));assert(!partial.text('stat-volume-note').includes('last available update'));
  const complete=fixture({direct:{status:'ready',coverage:'complete',scannedSignatures:0},stale:true,scanned:0});assert.equal(complete.empty.detail,'No buys were found in the available 24-hour trade records.');assert.equal(complete.text('stat-trades-note'),'0 wallet transactions checked · complete Pump/PumpSwap history');assert.equal(complete.text('stat-volume'),'$0.00');
});
test('loading/unavailable/registry incomplete remain unknown, never successful empty',()=>{
  for(const options of [{scanned:0},{direct:{status:'loading'}},{direct:{status:'unavailable'}}]){const f=fixture(options);assert.deepEqual(f.empty,{title:'Activity unavailable',detail:'Some activity cannot be shown right now. Please check again later.'});assert.equal(f.text('stat-volume'),'$—');assert.equal(f.text('stat-trades'),'—');assert(!f.text('stat-volume-note').includes('No trades'));}
  assert.equal(fixture({direct:{status:'loading'}}).text('stat-volume-note'),'Checking finalized wallet trades');
  assert.deepEqual(fixture({registry:'unavailable',filter:'all'}).empty,{title:'Activity unavailable',detail:'Some activity cannot be shown right now. Please check again later.'});
});
test('launch/burn-only, Created, Balances and private empty/history messages remain exact',()=>{
  for(const filter of ['launch','burn'])assert.deepEqual(fixture({filter}).empty,{title:'No matching activity',detail:`No confirmed ${filter} history was found for this wallet.`});
  assert.deepEqual(fixture({tab:'created'}).empty,{title:'No created coins found',detail:'No confirmed launch was found for this wallet.'});
  assert(fixture({tab:'balances'}).content.includes('Unavailable'));assert(!fixture({tab:'balances'}).content.includes('24-hour'));
  for(const filter of ['buy','sell','all','claim','reward','airdrop','bonus']){const f=fixture({self:true,filter});assert.equal(f.text('stat-volume-note'),'No recent trades found');assert.equal(f.text('stat-sol'),'1.25 SOL');assert(!f.content.includes('available 24-hour'));assert.equal(f.empty.detail,filter==='all'?'No confirmed launches, trades, burns, or wallet payments were found.':`No confirmed ${filter} history was found for this wallet.`);}
  for(const coverage of ['partial','unavailable','sign-in-required','pending']){const f=fixture({self:true,filter:'bonus',historyCoverage:{bonus:coverage}});assert.equal(f.empty.title,'Bonus history incomplete');assert(!f.empty.detail.includes('available public records'));}
});
test('populated rows retain sort, amounts, explorer targets and private proof rows; scan updates retain selection',()=>{
  const trades=[{side:'buy',mint:address,signature:'3'.repeat(64),solAmount:1.25,blockTime:10,symbol:'QA'},{side:'sell',mint:address,signature:'4'.repeat(64),solAmount:0.5,blockTime:20,symbol:'QA'}];
  const f=fixture({filter:'all',trades});assert.equal(f.text('stat-volume'),'$175.00');assert.equal(f.text('stat-trades'),'2');assert.equal(f.text('stat-volume-note'),'Estimated USD at the current SOL price');assert(f.content.indexOf('Sold QA')<f.content.indexOf('Bought QA'));assert(f.content.includes('1.25 SOL'));assert(f.content.includes('0.5 SOL'));assert(f.content.includes('?cluster=devnet'));assert(!f.content.includes('No trades'));
  const old=f.content;f.state.exploreScannedCount=18;f.state.exploreProviderStatus='stale';renderWalletDetail(f.state,f.deps);assert.equal(f.nodes['#wallet-detail-content'].innerHTML,old);assert.equal(f.filters[0].attrs['aria-pressed'],'true');assert.equal(f.tabs[0].attrs['aria-selected'],'true');
  const historyRows=[{type:'claim',title:'Recorded payment',detail:'Verified source',href:'https://explorer.solana.com/tx/proof?cluster=devnet',amount:'0.123127 SOL',time:20000}];
  assert(!fixture({filter:'all',historyRows}).content.includes('Recorded payment'));assert(fixture({self:true,filter:'all',historyRows}).content.includes('0.123127 SOL'));
  const launches=[{mint:address,name:'Created QA',symbol:'QA',time:15000,createdAt:'2026-10-21T12:00:00Z',creatorLaunchBurn:{status:'verified',receipt:{signature:'5'.repeat(64),amountTokens:366}}}];
  const rows=fixture({filter:'all',trades,launches});assert(rows.content.includes('Created Created QA'));assert(rows.content.includes('Burned $FUNDED'));assert(rows.content.includes('366 $FUNDED'));assert(rows.content.indexOf('Burned $FUNDED')<rows.content.indexOf('Sold QA'));assert.equal(fixture({filter:'bonus'}).empty.detail,fixture({filter:'all'}).empty.detail);
});
