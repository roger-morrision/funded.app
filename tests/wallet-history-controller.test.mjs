import test from 'node:test';
import assert from 'node:assert/strict';
import { createPortfolioController } from '../src/app/controllers/portfolio.js';
const wallet = 'ER7zhtSwfSu7B5Wb7uFwnWSZPLMmezmSXieY5JyLFzXC';
const other = '7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y';
function setup({ referralStatus = 401, firstDaily } = {}) {
  let pathWallet = wallet, dailyCalls = 0;
  const rendered = [], calls = [];
  const app = { connectedWalletAddress:wallet, verifiedLaunchPolicies:[],
    getWalletDetailAddress:() => pathWallet, validateSolanaMint:() => ({ valid:true }),
    renderWalletDetailView:state => rendered.push(structuredClone(state.walletHistory)),
    async apiRequest(path) {
      calls.push(path);
      if (path.startsWith('/api/rewards/experience')) return { available:true, data:{ cluster:'devnet', wallet:{ address:new URL(path, 'https://fixture').searchParams.get('wallet'), rows:[] } } };
      if (path === '/api/airdrops/reserves') return { available:true, data:{ cluster:'devnet', reserves:[] } };
      if (path.startsWith('/api/referral-claims')) { const error = new Error('fixture'); error.status = referralStatus; throw error; }
      if (path === '/api/daily-bonus') {
        if (++dailyCalls === 1 && firstDaily) return firstDaily;
        return { available:true, data:{ cluster:'devnet', snapshots:[] } };
      }
      throw new Error(`Unexpected ${path}`);
    } };
  const controller = createPortfolioController(app);
  app.renderWalletDetail = controller.renderWalletDetail;
  return { app, controller, rendered, calls, navigate(address) { pathWallet = address; } };
}
test('wallet history keeps available Daily bonus separate from referral sign-in and server errors', async () => {
  for (const [status, expected] of [[401, 'sign-in-required'], [403, 'sign-in-required'], [503, 'unavailable']]) {
    const f = setup({ referralStatus:status });
    await f.controller.refreshWalletDetailHistory(wallet);
    const history = f.rendered.at(-1);
    assert.equal(history.coverage.dailyBonus, 'ready');
    assert.equal(history.coverage.referralBonus, expected);
    assert.equal(history.coverage.bonus, 'partial');
    assert.deepEqual(history.rows, []);
  }
});
test('a late Daily bonus response cannot replace the newly connected wallet history', async () => {
  let resolve;
  const firstDaily = new Promise(done => { resolve = done; });
  const f = setup({ firstDaily });
  const pending = f.controller.refreshWalletDetailHistory(wallet);
  f.app.connectedWalletAddress = other; f.navigate(other);
  await f.controller.refreshWalletDetailHistory(other);
  resolve({ available:true, data:{ cluster:'devnet', snapshots:[] } });
  await pending;
  assert.equal(f.rendered.at(-1).wallet, other);
  assert.equal(f.rendered.some(row => row.wallet === wallet && row.status === 'ready'), false);
});
test('other-wallet and disconnected views never request private bonus history', async () => {
  const f = setup(); f.app.connectedWalletAddress = other;
  await f.controller.refreshWalletDetailHistory(wallet);
  f.app.connectedWalletAddress = null;
  await f.controller.refreshWalletDetailHistory(wallet);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.rendered.at(-1).rows, []);
});
