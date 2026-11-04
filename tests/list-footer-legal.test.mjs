import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('Get listed footer links to Privacy, Terms and Disclosures', () => {
  const footer = html.match(/<footer class="list-footer">[\s\S]*?<\/footer>/)?.[0] || '';
  assert.ok(footer, 'Get listed footer exists');
  assert.match(footer, /href="#privacy"/);
  assert.match(footer, /href="#terms" data-info="terms"/);
  assert.match(footer, /href="#disclosures" data-info="disclosures"/);
});
