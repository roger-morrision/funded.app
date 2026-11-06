import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('one shared site footer links to Privacy, Terms and Disclosures', () => {
  const footers = html.match(/<footer class="site-footer"[\s\S]*?<\/footer>/g) || [];
  assert.equal(footers.length, 1, 'exactly one shared site footer');
  const [footer] = footers;
  assert.match(footer, /href="#privacy"/);
  assert.match(footer, /href="#terms" data-info="terms"/);
  assert.match(footer, /href="#disclosures" data-info="disclosures"/);
  assert.match(footer, /href="#list"/, 'footer keeps the Get listed destination');
});

test('page-specific footers are not reintroduced', () => {
  assert.doesNotMatch(html, /class="(list-footer|explore-page-footer|home-reference-footer)"/);
});
