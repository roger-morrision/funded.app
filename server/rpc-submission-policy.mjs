import {readFileSync} from 'node:fs';
import {AddressLookupTableAccount, AddressLookupTableProgram, PublicKey, VersionedTransaction} from '@solana/web3.js';
import bs58 from 'bs58';
import {rpcWriteBlocked} from './network-write-policy.mjs';

const plan = JSON.parse(readFileSync(new URL('../config/mainnet-deployment-plan.json', import.meta.url)));
const release = JSON.parse(readFileSync(new URL('../config/mainnet-program-release.json', import.meta.url)));
const upgradeableLoader = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const programSettings = ['FUNDED_MAINNET_PROGRAM_ID', 'FUNDED_V3_FEE_ROUTER_PROGRAM_ID',
  'FUNDED_FEE_ROUTER_PROGRAM_ID', 'FUNDED_DEVELOPER_TOKEN_LOCK_PROGRAM_ID', 'FUNDED_DEVELOPER_LOCK_PROGRAM_ID',
  'VITE_FUNDED_V3_FEE_ROUTER_PROGRAM_ID', 'VITE_FUNDED_FEE_ROUTER_PROGRAM_ID'];

// Inspect every resolved key, not just top-level programs: a CPI must receive
// its target program as an account. Missing/malformed lookup evidence fails closed.
// readAccounts returns the JSON-RPC result from finalized getMultipleAccounts.
export async function rpcSubmissionBlocked(cluster, request, {env = process.env, readAccounts} = {}) {
  if (rpcWriteBlocked(cluster, request.method, env)) return true;
  if (cluster !== 'mainnet-beta' || request.method !== 'sendTransaction') return false;
  try {
    const protectedKeys = new Set([plan.mainnetProgramId, release.programId,
      ...programSettings.map(name => env[name])].filter(Boolean).map(key => new PublicKey(key).toBase58()));
    if (!plan.mainnetProgramId) return true;
    // Loader SetAuthority can name only ProgramData, without the executable
    // program account. Protect the canonical metadata account as well.
    for (const key of [...protectedKeys]) protectedKeys.add(
      PublicKey.findProgramAddressSync([new PublicKey(key).toBuffer()], upgradeableLoader)[0].toBase58());
    if (!Array.isArray(request.params) || request.params.length < 1 || request.params.length > 2) return true;
    const [encoded, options = {}] = request.params;
    if (!options || typeof options !== 'object' || Array.isArray(options) || typeof encoded !== 'string'
      || !encoded.length || encoded.length > 1700) return true;
    const encoding = options.encoding ?? 'base58';
    const bytes = encoding === 'base64' ? Buffer.from(encoded, 'base64')
      : encoding === 'base58' ? Buffer.from(bs58.decode(encoded)) : null;
    if (!bytes || bytes.length > 1232 || (encoding === 'base64' ? bytes.toString('base64') : bs58.encode(bytes)) !== encoded) return true;
    const transaction = VersionedTransaction.deserialize(bytes), message = transaction.message;
    if (!Buffer.from(transaction.serialize()).equals(bytes)) return true;
    const keys = [...message.staticAccountKeys];
    if (keys.some(key => protectedKeys.has(key.toBase58()))) return true;
    const lookups = message.addressTableLookups;
    if (lookups.length) {
      if (lookups.length > 32 || typeof readAccounts !== 'function') return true;
      const result = await readAccounts(lookups.map(table => table.accountKey.toBase58()));
      if (!Number.isSafeInteger(result?.context?.slot) || result.context.slot < 0
        || !Array.isArray(result.value) || result.value.length !== lookups.length) return true;
      const tables = result.value.map((account, i) => {
        if (account?.owner !== AddressLookupTableProgram.programId.toBase58() || account.executable !== false
          || !Array.isArray(account.data) || account.data[1] !== 'base64' || typeof account.data[0] !== 'string'
          || account.data[0].length > 11000) throw Error('Invalid lookup table');
        const data = Buffer.from(account.data[0], 'base64');
        if (data.toString('base64') !== account.data[0]) throw Error('Invalid lookup encoding');
        return new AddressLookupTableAccount({key: lookups[i].accountKey, state: AddressLookupTableAccount.deserialize(data)});
      });
      const loaded = message.resolveAddressTableLookups(tables);
      keys.push(...loaded.writable, ...loaded.readonly);
    }
    if (keys.length > 256 || keys.some(key => protectedKeys.has(key.toBase58()))) return true;
    return message.compiledInstructions.some(ix => ix.programIdIndex >= keys.length
      || ix.accountKeyIndexes.some(index => index >= keys.length));
  } catch { return true; }
}
