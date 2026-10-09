import { readFileSync } from 'node:fs';
import { appSourceModules } from '../src/app/source-modules.js';

// Compatibility for existing source assertions and isolated VM fixtures.
// This reads maintained modules, never a saved copy or generated browser bundle.
// Runtime code imports the modules directly and does not use this reconstruction.
export function readAppSourceSync() {
  const imports = readFileSync(new URL('../src/app/dependencies.js', import.meta.url), 'utf8')
    .split('export const appDependencies =')[0]
    .replace(/(from |import )'\.\.\/\.\.\//g, "$1'./");
  const statements = [];
  for (const file of appSourceModules) {
    const source = readFileSync(new URL(`../src/app/${file}`, import.meta.url), 'utf8');
    for (const match of source.matchAll(/^  \/\/ app-source: (\d+)\r?\n([\s\S]*?)^  \/\/ app-source-end/gm)) {
      const text = match[2].replace(/^  /gm, '')
        .replace(/^initializeAppState\(appState, '[^']+', [^\n]+\);\r?\n/gm, '')
        .replace(/\bappState\.([A-Za-z_$][\w$]*)/g, '$1')
        .replace(/\b([A-Za-z_$][\w$]*): \1(?=\s*[,}])/g, '$1')
        .replace(/import\('\.\.\/\.\.\/\.\.\//g, "import('./");
      statements.push({ order: Number(match[1]), text });
    }
  }
  if (new Set(statements.map(row => row.order)).size !== statements.length) throw new Error('Duplicate app source ordering marker');
  return imports + statements.sort((a, b) => a.order - b.order).map(row => row.text).join('\n');
}

export async function readAppSource() { return readAppSourceSync(); }
