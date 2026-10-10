import { randomUUID } from 'node:crypto';
export const SYMBOLS = ['BTC_USDT', 'ETH_USDT', 'SOL_USDT', 'AAPL', 'MSFT', 'NVDA'];
export function emptyBook(symbol) { return { _id: symbol, revision: 0, bids: [], asks: [], lastPrice: null, trades: [] }; }
export function validateOrder(input) {
  if (!input || !SYMBOLS.includes(input.symbol)) throw new Error('Unsupported symbol');
  if (!['buy', 'sell'].includes(input.side)) throw new Error('Side must be buy or sell');
  // Integer cents and units avoid binary floating point accounting errors.
  if (!Number.isSafeInteger(input.priceCents) || input.priceCents < 1 || input.priceCents > 100000000) throw new Error('priceCents must be an integer from 1 to 100000000');
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 1000000) throw new Error('quantity must be an integer from 1 to 1000000');
  return { symbol: input.symbol, side: input.side, priceCents: input.priceCents, quantity: input.quantity };
}
export function matchOrder(current, input, id = randomUUID(), now = Date.now()) {
  const orderInput = validateOrder(input);
  const book = structuredClone(current), trades = [], updates = [];
  if (book._id !== input.symbol) throw new Error('Book symbol mismatch');
  if (book.bids.length + book.asks.length >= 1000) { const error = new Error('Demo book capacity reached'); error.status = 422; throw error; }
  const order = { ...orderInput, id, remaining: input.quantity, createdAt: now, sequence: book.revision + 1, status: 'open' };
  const opposite = input.side === 'buy' ? book.asks : book.bids;
  while (order.remaining > 0 && opposite.length) {
    const resting = opposite[0];
    if (input.side === 'buy' ? input.priceCents < resting.priceCents : input.priceCents > resting.priceCents) break;
    const quantity = Math.min(order.remaining, resting.remaining);
    order.remaining -= quantity; resting.remaining -= quantity;
    resting.status = resting.remaining === 0 ? 'filled' : 'partial';
    updates.push({ ...resting });
    const trade = { id: randomUUID(), symbol: input.symbol, priceCents: resting.priceCents, quantity, buyOrderId: input.side === 'buy' ? id : resting.id, sellOrderId: input.side === 'sell' ? id : resting.id, at: now };
    trades.push(trade); book.lastPrice = trade.priceCents;
    if (!resting.remaining) opposite.shift();
  }
  order.status = order.remaining === 0 ? 'filled' : order.remaining < order.quantity ? 'partial' : 'open';
  if (order.remaining) {
    const same = input.side === 'buy' ? book.bids : book.asks; same.push({ ...order });
    same.sort((a, b) => (input.side === 'buy' ? b.priceCents - a.priceCents : a.priceCents - b.priceCents) || a.sequence - b.sequence);
  }
  book.revision++; book.trades = [...trades].reverse().concat(book.trades).slice(0, 100);
  return { book, order, trades, updates };
}
export function publicBook(book) {
  function levels(orders) {
    const totals = new Map();
    for (const o of orders) totals.set(o.priceCents, (totals.get(o.priceCents) ?? 0) + o.remaining);
    return [...totals].slice(0, 12).map(([priceCents, quantity]) => ({ priceCents, quantity }));
  }
  return { symbol: book._id, revision: book.revision, bids: levels(book.bids), asks: levels(book.asks), lastPrice: book.lastPrice, trades: book.trades.slice(0, 20) };
}
