// Ratchet for stylesheet sprawl: counts may go down, never up.
// When a cleanup lowers a count, lower the matching budget in the same change.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const BUDGET = { files: 125, important: 454, hexColors: 2664 };

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '*.css'], { encoding: 'utf8' })
  .split('\n').filter(path => path && !/^(dist|dist-mainnet-readonly|node_modules|public\/vendor)\//.test(path));
let important = 0;
const hexColors = new Set();
for (const path of files) {
  // Count declarations and colors, not comments (a policy note mentioning !important is not a use).
  const source = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  important += source.match(/!important/g)?.length || 0;
  for (const color of source.match(/#[0-9a-fA-F]{6}\b/g) || []) hexColors.add(color.toLowerCase());
}
const actual = { files: files.length, important, hexColors: hexColors.size };
const over = Object.keys(BUDGET).filter(key => actual[key] > BUDGET[key]);
console.log(Object.keys(BUDGET).map(key => `${key}: ${actual[key]} / ${BUDGET[key]}`).join('\n'));
if (over.length) {
  console.error(`CSS budget exceeded for ${over.join(', ')}. Reuse the --fv-* tokens in styles/clarity.css and existing rules instead of adding overrides.`);
  process.exit(1);
}
