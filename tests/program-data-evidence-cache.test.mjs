import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, PublicKey } from '@solana/web3.js';
import { readProgramDataEvidence } from '../server/program-data-evidence.mjs';

const LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');

function fakeChain() {
  const program = Keypair.generate().publicKey, programData = Keypair.generate().publicKey;
  const programAccount = { executable: true, owner: LOADER, lamports: 1, data: Buffer.concat([Buffer.from([2, 0, 0, 0]), programData.toBuffer()]) };
  const chain = { slot: 100n, lamports: 5_000, body: Buffer.alloc(4096, 7), fullReads: 0 };
  const dataAccount = () => {
    const header = Buffer.alloc(45); header.writeUInt32LE(3, 0); header.writeBigUInt64LE(chain.slot, 4);
    return { executable: false, owner: LOADER, lamports: chain.lamports, data: Buffer.concat([header, chain.body]) };
  };
  const connection = {
    async getAccountInfo(key, config) {
      if (key.equals(program)) return programAccount;
      const account = dataAccount();
      if (config?.dataSlice) return { ...account, data: account.data.subarray(config.dataSlice.offset, config.dataSlice.offset + config.dataSlice.length) };
      chain.fullReads++; return account;
    },
  };
  return { program, connection, chain };
}

test('program evidence reuses a hashed binary while the ProgramData header is unchanged', async () => {
  const { program, connection, chain } = fakeChain();
  const first = await readProgramDataEvidence(connection, program, { cluster: 'devnet', rpcUrl: '' });
  const second = await readProgramDataEvidence(connection, program, { cluster: 'devnet', rpcUrl: '' });
  assert.equal(chain.fullReads, 1);
  assert.equal(second.sha256, first.sha256);
  assert.equal(second.programData.data.length, 45 + 4096);
});

test('program evidence re-reads the full binary after an upgrade or extension', async () => {
  const { program, connection, chain } = fakeChain();
  const first = await readProgramDataEvidence(connection, program, { cluster: 'devnet', rpcUrl: '' });
  chain.slot = 200n; chain.body = Buffer.alloc(4096, 9);
  const upgraded = await readProgramDataEvidence(connection, program, { cluster: 'devnet', rpcUrl: '' });
  assert.equal(chain.fullReads, 2);
  assert.notEqual(upgraded.sha256, first.sha256);
  chain.lamports += 1_000; chain.body = Buffer.alloc(8192, 9);
  const extended = await readProgramDataEvidence(connection, program, { cluster: 'devnet', rpcUrl: '' });
  assert.equal(chain.fullReads, 3);
  assert.equal(extended.programData.data.length, 45 + 8192);
});
