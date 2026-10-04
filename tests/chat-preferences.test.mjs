import test from 'node:test';
import assert from 'node:assert/strict';
import { readHiddenChatAuthors, hideChatAuthor, resetHiddenChatAuthors } from '../token-chat-preferences.js';
test('chat hiding is scoped to the network and reversible on this device', () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  const address = '1'.repeat(32);
  hideChatAuthor('devnet', address, storage);
  assert.equal(readHiddenChatAuthors('devnet', storage).has(address), true);
  assert.equal(readHiddenChatAuthors('mainnet-beta', storage).size, 0);
  assert.throws(() => hideChatAuthor('devnet', '<script>', storage));
  resetHiddenChatAuthors('devnet', storage);
  assert.equal(readHiddenChatAuthors('devnet', storage).size, 0);
});
