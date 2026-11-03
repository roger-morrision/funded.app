import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../welcome.html', import.meta.url), 'utf8');
const text = value => value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

test('About page section headings are not repeated', () => {
  const headings = [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/g)].map(match => text(match[1]));
  const repeated = headings.filter((heading, index) => headings.indexOf(heading) !== index);
  assert.deepEqual(repeated, []);
});

test('About section headings do not repeat the hero slogan', () => {
  const slogan = text(html.match(/<p class="eyebrow">([\s\S]*?)<\/p>/)[1]);
  assert.ok(slogan.length > 0);
  const headings = [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/g)].map(match => text(match[1]));
  assert.ok(!headings.includes(slogan), `"${slogan}" is already the hero slogan`);
});
