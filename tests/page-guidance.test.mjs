import test from 'node:test';
import assert from 'node:assert/strict';
import {documentationTopics} from '../src/features/help/docs-topics.js';
import {productHelpTopics,productFaqs} from '../src/features/help/product-guidance.js';
import {helpTopicForLocation} from '../src/features/help/page-guidance.js';

test('every Help and FAQ guide link resolves to a unique maintained Docs topic',()=>{
  const topics=documentationTopics.flatMap(group=>group.items),ids=new Set(topics.map(topic=>topic.id));
  assert.equal(ids.size,topics.length);
  const content=[...Object.values(productHelpTopics()).map(topic=>topic.href),
    ...productFaqs().map(row=>row[2]),...topics.map(topic=>typeof topic.body==='function'?topic.body():topic.body)];
  for(const body of content)for(const match of body.matchAll(/#docs\/([a-z0-9-]+)/g))assert.ok(ids.has(match[1]),`Missing guide: ${match[1]}`);
});
test('all app page contexts select an available Help answer without changing routes',()=>{
  const topics=productHelpTopics();
  const cases={overview:'home',explore:'search',community:'following',launch:'launch',list:'listing',
    'my-launches':'portfolio','payments/holders':'rewards',referrals:'referral','referral-faq':'referral',
    airdrops:'airdrop',bonuses:'bonus',buybacks:'buyback','capital-flow':'capital-flow',
    'analytics-detail':'analytics',leaderboard:'leaderboard','marketing-agency':'marketing-agency',
    callouts:'callouts','community-pilot':'community-pilot',profile:'settings','creator-settings':'creator-updates',
    privacy:'privacy',terms:'privacy',disclosures:'rewards',paid:'funded','docs/fees':'fees',
    'docs/marketing-agency':'marketing-agency','payments/x':'x','payments/history':'history'};
  for(const [hash,expected]of Object.entries(cases)){const location={pathname:'/',hash:`#${hash}`};assert.equal(helpTopicForLocation(location),expected);assert.ok(topics[expected]);assert.equal(location.hash,`#${hash}`);}
  for(const [pathname,expected]of [['/token/mint','coin'],['/launch/coin/mint','coin'],['/wallet/address','portfolio'],['/creator/x/123','creator-updates'],['/admin','admin'],['/list','listing'],['/funded','funded'],['/explore','search'],['/pilot','launch']])assert.equal(helpTopicForLocation({pathname}),expected);
  assert.equal(helpTopicForLocation({hash:'#unknown'}),'home');
});
