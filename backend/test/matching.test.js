import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBook, matchOrder, validateOrder, publicBook } from '../src/matching.js';
const sell = (priceCents, quantity) => ({ symbol: 'BTC_USDT', side: 'sell', priceCents, quantity });
const buy = (priceCents, quantity) => ({ symbol: 'BTC_USDT', side: 'buy', priceCents, quantity });
test('crossing orders execute at resting price with partial fill', () => {
  const a = matchOrder(emptyBook('BTC_USDT'), sell(10000, 5), 's1', 1);
  const b = matchOrder(a.book, buy(11000, 3), 'b1', 2);
  assert.equal(b.order.status, 'filled'); assert.equal(b.book.asks[0].remaining, 2); assert.equal(b.trades[0].priceCents, 10000); assert.equal(b.trades[0].quantity, 3);
  assert.equal(b.updates[0].status, 'partial'); assert.equal(a.book.asks[0].remaining, 5);
});
test('best price wins, then FIFO sequence, across several fills', () => {
  let b = emptyBook('BTC_USDT'); b = matchOrder(b, sell(110, 2), 'late-expensive', 1).book;
  b = matchOrder(b, sell(100, 2), 'first-cheap', 1).book; b = matchOrder(b, sell(100, 3), 'second-cheap', 1).book;
  const r = matchOrder(b, buy(120, 6), 'buy', 2);
  assert.deepEqual(r.trades.map(t => t.sellOrderId), ['first-cheap', 'second-cheap', 'late-expensive']);
  assert.equal(r.book.asks[0].remaining, 1); assert.equal(r.order.remaining, 0);
});
test('noncrossing orders rest and aggregate levels', () => {
  let b = matchOrder(emptyBook('BTC_USDT'), buy(100, 2), 'b1').book;
  b = matchOrder(b, buy(100, 3), 'b2').book; b = matchOrder(b, sell(110, 4), 's1').book;
  assert.deepEqual(publicBook(b).bids, [{ priceCents: 100, quantity: 5 }]); assert.equal(b.trades.length, 0);
});
test('reject unsafe and malformed inputs', () => {
  for (const invalid of [null, buy(1.5, 2), buy(-1, 2), buy(100, 0), buy(100, 2.5), { ...buy(100, 1), symbol: 'UNKNOWN' }, { ...buy(100, 1), side: 'hold' }]) assert.throws(() => validateOrder(invalid));
});
test('seeded matching conserves quantity and keeps books uncrossed', () => {
  let b = emptyBook('BTC_USDT'), inputQty = 0, executed = 0, seed = 91;
  const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  for (let i = 0; i < 500; i++) {
    const input = { symbol: 'BTC_USDT', side: rand() % 3 === 0 ? 'sell' : 'buy', priceCents: 90 + rand() % 21, quantity: 1 + rand() % 5 };
    inputQty += input.quantity; const r = matchOrder(b, input, `id${i}`); b = r.book; executed += r.trades.reduce((sum,t) => sum + t.quantity, 0);
    assert.equal(inputQty, b.bids.concat(b.asks).reduce((sum,o) => sum + o.remaining, 0) + 2 * executed);
    if (b.bids.length && b.asks.length) assert.ok(b.bids[0].priceCents < b.asks[0].priceCents);
  }
});
