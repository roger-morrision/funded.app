import { readFileSync, writeFileSync } from 'node:fs';

const path = '/app/server/index.mjs';
let source = readFileSync(path, 'utf8');
const edits = [
  {
    anchor: "    { suffix:'operations', kind:'operations', amount:solToLamports(settlement.fundedApp?.operations), recipient:process.env.FUNDED_PUMP_REVENUE_WALLET, status:'pending' },",
    addition: "    { suffix:'community', kind:'community-reserve', amount:solToLamports(settlement.fundedApp?.community), recipient:null, status:'pending' },",
  },
  {
    anchor: "          ['x', settlement.creatorDestinations?.solClaim],",
    addition: "          ['operations', settlement.fundedApp?.operations],\n          ['community', settlement.fundedApp?.community],",
  },
];
for (const { anchor, addition } of edits) {
  if (source.includes(addition)) continue;
  if (source.split(anchor).length !== 2) throw new Error('The base Devnet API image has changed; inspect before applying the reserve overlay.');
  source = source.replace(anchor, `${anchor}\n${addition}`);
}
writeFileSync(path, source);
