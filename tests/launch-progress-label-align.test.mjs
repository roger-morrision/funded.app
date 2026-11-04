import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../styles/clarity.css', import.meta.url), 'utf8');

test('coin card progress stage label sits at the right edge of its row', () => {
  const rule = css.match(/\.home-launch-progress-heading strong \{[^}]*\}/)?.[0] || '';
  assert.ok(rule, 'progress heading label rule exists');
  assert.match(rule, /text-align: end;/);
});
