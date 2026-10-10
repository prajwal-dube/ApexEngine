import { MongoClient } from 'mongodb';
import { emptyBook, SYMBOLS, matchOrder } from './matching.js';
export class Store {
  constructor(uri) { this.client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 }); this.tail = Promise.resolve(); this.pending = 0; }
  async connect() {
    await this.client.connect(); this.db = this.client.db();
    this.books = this.db.collection('books'); this.orders = this.db.collection('orders'); this.trades = this.db.collection('trades');
    await this.orders.createIndex({ symbol: 1, createdAt: -1 });
    for (const symbol of SYMBOLS) await this.books.updateOne({ _id: symbol }, { $setOnInsert: emptyBook(symbol) }, { upsert: true });
  }
  // A bounded process-local FIFO gives one writer deterministic arrival order.
  submit(input, key) {
    if (this.pending >= 500) { const e = new Error('Writer queue full; retry later'); e.status = 503; throw e; }
    this.pending++;
    const task = this.tail.then(() => this.commit(input, key)).finally(() => { this.pending--; });
    this.tail = task.catch(() => {}); return task;
  }
  async commit(input, key) {
    const session = this.client.startSession(); let result;
    try {
      await session.withTransaction(async () => {
        const prior = await this.orders.findOne({ _id: key }, { session });
        if (prior) {
          if (JSON.stringify(prior.request) !== JSON.stringify(input)) { const e = new Error('Idempotency key already used for a different order'); e.status = 409; throw e; }
          result = prior.receipt; return;
        }
        const current = await this.books.findOne({ _id: input.symbol }, { session });
        const matched = matchOrder(current, input, key);
        await this.books.replaceOne({ _id: input.symbol }, matched.book, { session });
        for (const resting of matched.updates) await this.orders.updateOne({ _id: resting.id }, { $set: { state: resting } }, { session });
        if (matched.trades.length) await this.trades.insertMany(matched.trades.map(t => ({ ...t, _id: t.id })), { session });
        result = { order: matched.order, trades: matched.trades, revision: matched.book.revision };
        await this.orders.insertOne({ _id: key, symbol: input.symbol, createdAt: matched.order.createdAt, request: input, state: matched.order, receipt: result }, { session });
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
      return result;
    } finally { await session.endSession(); }
  }
  async close() { await this.tail; await this.client.close(); }
}
