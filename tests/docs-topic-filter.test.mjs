import test from 'node:test';
import assert from 'node:assert/strict';
import { documentationTopics as groups } from '../src/features/help/docs-topics.js';
import { filterDocumentationTopics as filter } from '../src/features/help/docs-topic-filter.js';
const all=groups.flatMap(group=>group.items),ids=query=>filter(groups,query).map(topic=>topic.id);
test('empty and whitespace query preserve all29 original topic objects in order',()=>{
 assert.equal(all.length,29);for(const query of['','  \n\t']){const result=filter(groups,query);assert.deepEqual(result,all);result.forEach((topic,i)=>assert.equal(topic,all[i]));}
});
test('title matching trims/case-folds a literal query without body indexing',()=>{
 assert.deepEqual(ids('  PENDING  '),['troubleshooting']);assert.deepEqual(ids('wallet'),['wallet','profile','history']);assert.deepEqual(ids('monetary value'),[]);
});
test('group matching includes all eight Fees and SOL rewards topics once in original order',()=>{
 assert.deepEqual(ids('FEES'),['fees','creator-fees','reward-actions','holders','x-rewards','referrals','daily-bonus','buyback']);assert.equal(new Set(ids('fees')).size,8);
});
test('regex/HTML punctuation stays literal and never evaluates article bodies',()=>{
 for(const query of['.*','[','<script>','no-such-guide-050'])assert.deepEqual(ids(query),[]);
 const item={id:'literal',title:'A literal [fee].*',get body(){throw Error('Article body must not be indexed');}};const fixture=[{group:'Safe group',items:[item]}];assert.deepEqual(filter(fixture,'[fee].*'),[item]);assert.deepEqual(filter(fixture,'Safe group'),[item]);assert.deepEqual(filter(fixture,'<b>'),[]);
});
