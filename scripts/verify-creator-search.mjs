import assert from 'node:assert/strict';
import { searchGrams } from '../server/creator-search.mjs';
const names=['@alice Alice creator','@bob BOB','@test 100%_literal','@unicode Tuan 🐸 creator','@other น่ารัก'];
for(const text of names)for(const query of ['a','al','ali','alice','bob','%_','🐸','🐸 c','น่า','not found']) {
  const indexed=searchGrams(text,true),required=searchGrams(query);
  if(text.toLowerCase().includes(query))assert.ok(required.every(gram=>indexed.includes(gram)),`Index must not omit a real match: ${query}`);
  for(const gram of indexed)assert.equal(Buffer.from(gram).toString(),gram,'Grams preserve valid Unicode.');
}
assert.deepEqual(searchGrams(''),[]);assert.deepEqual(searchGrams('aaaa'),['aaa']);
console.log('Creator search: short queries, Unicode code points, repeated grams and literal wildcard parity passed.');
