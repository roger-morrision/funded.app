import { readFile } from 'node:fs/promises';
import { summarizePilot } from '../pilot-metrics-model.js';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: node scripts/summarize-pilot-metrics.mjs participant-export.json [...]');
  process.exitCode = 2;
} else {
  const records = await Promise.all(files.map(async path => JSON.parse(await readFile(path, 'utf8'))));
  const result = summarizePilot(records);
  console.log(JSON.stringify({ basis:'consented local-device exports only; test sources excluded',
    observedAt:new Date().toISOString(), ...result }, null, 2));
}
