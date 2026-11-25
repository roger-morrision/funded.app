import assert from 'node:assert/strict';
import {PublicKey} from '@solana/web3.js';

const sections = ['instructions', 'accounts', 'types', 'events', 'errors', 'constants'];
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// Preserve array order: instruction accounts, fields and enum variants are ABI.
// Documentation and JSON object key ordering do not affect the interface.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!plain(value)) return value;
  return Object.fromEntries(Object.keys(value).filter(key => key !== 'docs').sort()
    .map(key => [key, canonical(value[key])]));
}
const signature = value => JSON.stringify(canonical(value));

function validate(idl) {
  assert(plain(idl), 'Expected an Anchor IDL object.');
  assert.equal(new PublicKey(idl.address).toBase58(), idl.address, 'IDL needs an explicit program address.');
  assert.equal(idl.metadata?.spec, '0.1.0', 'Only Anchor IDL spec 0.1.0 is supported; regenerate older IDLs.');
  assert(Array.isArray(idl.instructions) && idl.instructions.length, 'IDL must contain instructions.');
  for (const key of Object.keys(idl)) assert([...sections, 'address', 'metadata', 'docs'].includes(key),
    `Unsupported IDL section: ${key}`);
  const indexed = {};
  for (const section of sections) {
    const rows = idl[section] ?? [];
    assert(Array.isArray(rows), `Invalid IDL section: ${section}`);
    const map = new Map(), discriminators = new Set(), codes = new Set();
    for (const row of rows) {
      assert(plain(row) && typeof row.name === 'string' && row.name.length > 0, `Unnamed ${section} entry.`);
      assert(!map.has(row.name), `Duplicate ${section} name: ${row.name}`);
      map.set(row.name, row);
      if (['instructions', 'accounts', 'events'].includes(section)) {
        assert(Array.isArray(row.discriminator) && row.discriminator.length === 8
          && row.discriminator.every(n => Number.isInteger(n) && n >= 0 && n <= 255),
        `Expected an explicit eight-byte discriminator: ${section}.${row.name}`);
        const discriminator = row.discriminator.join(',');
        assert(!discriminators.has(discriminator), `Duplicate ${section} discriminator: ${row.name}`);
        discriminators.add(discriminator);
      }
      if (section === 'instructions') assert(Array.isArray(row.accounts) && Array.isArray(row.args),
        `Missing instruction accounts or arguments: ${row.name}`);
      if (section === 'types') assert(plain(row.type) && ['struct', 'enum', 'type'].includes(row.type.kind),
        `Unsupported type definition: ${row.name}`);
      if (section === 'errors') {
        assert(Number.isInteger(row.code) && row.code >= 0 && !codes.has(row.code), 'Invalid or duplicate error code.');
        codes.add(row.code);
      }
    }
    indexed[section] = map;
  }
  for (const section of ['accounts', 'events']) for (const name of indexed[section].keys())
    assert(indexed.types.has(name), `Missing ${section} type definition: ${name}`);
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (Object.hasOwn(value, 'defined')) {
      const name = typeof value.defined === 'string' ? value.defined : value.defined?.name;
      assert(indexed.types.has(name), `Unresolved IDL type: ${name}`);
    }
    for (const [key, item] of Object.entries(value)) if (key !== 'docs') visit(item);
  };
  for (const section of sections) visit(idl[section]);
  return indexed;
}

export function compareProgramInterfaces(baseline, candidate) {
  const before = validate(baseline), after = validate(candidate);
  const breaking = [], additions = [];
  if (baseline.address !== candidate.address) breaking.push({path:'address', reason:'Program identity changed.'});
  for (const section of sections) {
    for (const [name, old] of before[section]) {
      const next = after[section].get(name);
      if (!next) breaking.push({path:`${section}.${name}`, reason:'Existing entry removed.'});
      else if (signature(old) !== signature(next)) breaking.push({path:`${section}.${name}`,
        reason:'Existing interface or layout changed; requires explicit migration/client review.'});
    }
    for (const name of after[section].keys()) if (!before[section].has(name)) additions.push(`${section}.${name}`);
  }
  return {status:breaking.length ? 'migration-required' : 'compatible-interface', breaking, additions,
    scope:'Static IDL comparison only. Raw account bytes, PDA seeds omitted from IDL, authorization, economic behavior and account allocation require separate review and execution tests.'};
}
