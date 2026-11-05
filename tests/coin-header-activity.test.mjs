import test from 'node:test';import assert from 'node:assert/strict';import {renderHeaderActivity} from '../src/features/coin/header-activity.js';
const render=market=>{const nodes={'coin-strip-volume':{},'coin-strip-trades':{}};renderHeaderActivity(market,{document:{getElementById:id=>nodes[id]}});return nodes;};
test('header activity preserves partial coverage, complete zero and unavailable data',()=>{
 let nodes=render({status:'ready',coverage:'partial',volume24hSol:1.25,tradeCount:12});assert.equal(nodes['coin-strip-volume'].textContent,'≥1.25');assert.equal(nodes['coin-strip-trades'].textContent,'≥12');
 nodes=render({status:'ready',coverage:'complete',volume24hSol:0,tradeCount:0});assert.equal(nodes['coin-strip-volume'].textContent,'0');assert.equal(nodes['coin-strip-trades'].textContent,'0');
 for(const market of [{status:'unavailable',volume24hSol:0,tradeCount:0},{status:'ready',coverage:'complete',volume24hSol:null,tradeCount:null},{status:'ready',coverage:null,volume24hSol:1,tradeCount:1}]){nodes=render(market);assert.equal(nodes['coin-strip-volume'].textContent,'Unavailable');assert.equal(nodes['coin-strip-trades'].textContent,'Unavailable');}
 nodes=render({status:'loading'});assert.equal(nodes['coin-strip-trades'].textContent,'Checking…');
});
