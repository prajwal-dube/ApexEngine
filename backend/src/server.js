import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { hostname } from 'node:os';
import { Server } from 'socket.io';
import { Store } from './store.js';
import { SYMBOLS, publicBook, validateOrder } from './matching.js';
import { TieredCache } from './cache/tiered.js';
const role = process.env.ROLE ?? 'engine', port = Number(process.env.PORT ?? 4000);
if (!['engine', 'gateway'].includes(role)) throw new Error('ROLE must be engine or gateway');
const token = process.env.INTERNAL_TOKEN;
if (!token || token.length < 12) throw new Error('Set INTERNAL_TOKEN to a shared value of at least 12 characters');
const origin = process.env.CORS_ORIGIN ?? 'http://localhost:5173';
const store = new Store(process.env.MONGO_URI ?? 'mongodb://localhost:27017/apexengine?replicaSet=rs0&directConnection=true');
await store.connect();
const app = express(), http = createServer(app), io = new Server(http, { cors: { origin }, transports: ['websocket'], maxHttpBufferSize: 16384 });
app.use(cors({ origin })); app.use(express.json({ limit: '16kb' }));
const logs = []; let logId = 0;
const log = message => { logs.push({ id: ++logId, at: Date.now(), message }); if (logs.length > 120) logs.shift(); };
const cache = new TieredCache(Number(process.env.LRU_CAPACITY ?? 2), Number(process.env.LFU_CAPACITY ?? 4), log);
const generations = new Map(SYMBOLS.map(s => [s, 0]));
const metrics = { hits: 0, misses: 0, operations: 0, dbReads: 0, dbMs: 0, dbSamples: 0, l1Hits: 0, l2Hits: 0 };
const enabled = process.env.CACHE_ENABLED !== 'false'; let coherent = false, stopping = false, watcher;
const invalidate = key => { generations.set(key, generations.get(key) + 1); cache.delete(key); };
async function readBook(symbol) {
  metrics.operations++;
  if (enabled && coherent) {
    const hit = cache.get(symbol);
    if (hit) { metrics.hits++; metrics[hit.tier === 'L1' ? 'l1Hits' : 'l2Hits']++; return hit.value; }
  }
  metrics.misses++; metrics.dbReads++;
  const generation = generations.get(symbol), start = performance.now();
  const doc = await store.books.findOne({ _id: symbol });
  metrics.dbMs += performance.now() - start; metrics.dbSamples++;
  const value = publicBook(doc);
  // A change event arriving during an awaited DB read blocks stale cache fill.
  if (enabled && coherent && generations.get(symbol) === generation) cache.put(symbol, value);
  log(`DB READ ${symbol} revision=${value.revision}`); return value;
}
async function watchBooks() {
  while (!stopping) {
    coherent = false; cache.clear();
    try {
      watcher = store.books.watch([], { fullDocument: 'updateLookup', maxAwaitTimeMS: 500 });
      // Force cursor creation before permitting cache hits.
      const applyChange = change => {
        const symbol = change?.documentKey?._id;
        if (SYMBOLS.includes(symbol)) { invalidate(symbol); if (change.fullDocument) io.to(symbol).emit('book:update', publicBook(change.fullDocument)); }
      };
      const first = await watcher.tryNext(); applyChange(first);
      coherent = true; log('CHANGE STREAM connected; local cache empty');
      for await (const change of watcher) applyChange(change);
    } catch (error) { if (!stopping) log(`CHANGE STREAM disconnected: ${error.message}; caching bypassed`); }
    finally { coherent = false; cache.clear(); await watcher?.close().catch(() => {}); }
    if (!stopping) await new Promise(resolve => setTimeout(resolve, 1000));
  }
}
void watchBooks();
const wrap = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);
app.get('/health/live', (_, res) => res.json({ ok: true, role }));
app.get('/health/ready', wrap(async (_, res) => { await store.db.command({ ping: 1 }); res.json({ ok: true, role, cacheCoherent: coherent }); }));
app.get('/api/symbols', (_, res) => res.json(SYMBOLS));
app.get('/api/book/:symbol', wrap(async (req, res) => {
  if (!SYMBOLS.includes(req.params.symbol)) return res.status(400).json({ error: 'Unsupported symbol' });
  res.json(await readBook(req.params.symbol));
}));
app.get('/api/orders/:id', wrap(async (req, res) => {
  const order = await store.orders.findOne({ _id: req.params.id });
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json(order.state);
}));
async function accept(req, res) {
  let input; try { input = validateOrder(req.body); } catch (e) { e.status = 400; throw e; }
  const key = req.header('Idempotency-Key');
  if (!key || !/^[a-zA-Z0-9_-]{8,80}$/.test(key)) return res.status(400).json({ error: 'Provide an 8–80 character Idempotency-Key (letters, numbers, underscores or hyphens)' });
  let receipt;
  if (role === 'engine') receipt = await store.submit(input, key);
  else {
    const response = await fetch(`${process.env.ENGINE_URL ?? 'http://engine:4000'}/internal/orders`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key, 'X-Engine-Token': token },
      body: JSON.stringify(input), signal: AbortSignal.timeout(10000)
    });
    receipt = await response.json(); if (!response.ok) return res.status(response.status).json(receipt);
  }
  // DB transaction has already committed. Invalidate old value then refill from primary.
  invalidate(input.symbol); await readBook(input.symbol).catch(e => log(`CACHE REFILL skipped: ${e.message}`));
  metrics.operations++; log(`ORDER COMMIT ${key} revision=${receipt.revision}`);
  res.status(201).json(receipt);
}
app.post('/api/orders', wrap(accept));
app.post('/internal/orders', wrap(async (req, res) => {
  if (role !== 'engine' || req.header('X-Engine-Token') !== token) return res.status(403).json({ error: 'Forbidden' });
  await accept(req, res);
}));
io.on('connection', socket => {
  log(`SOCKET connected ${socket.id}`); socket.data.symbol = 'BTC_USDT'; socket.join('BTC_USDT');
  socket.on('subscribe', async (symbol, ack) => {
    if (!SYMBOLS.includes(symbol)) return;
    socket.leave(socket.data.symbol); socket.data.symbol = symbol; socket.join(symbol);
    try { socket.emit('book:update', await readBook(symbol)); if (typeof ack === 'function') ack({ ok: true }); }
    catch { socket.emit('service:error', { error: 'Book temporarily unavailable' }); }
  });
});
let prior = { ...metrics }, lastTick = performance.now();
const telemetry = setInterval(() => {
  const now = performance.now(), elapsed = (now - lastTick) / 1000;
  const dh = metrics.hits - prior.hits, dm = metrics.misses - prior.misses;
  const samples = metrics.dbSamples - prior.dbSamples;
  io.emit('telemetry', {
    at: Date.now(), node: hostname(), role, mode: 'live', cacheCoherent: coherent, cacheEnabled: enabled,
    hitRate: metrics.hits + metrics.misses ? metrics.hits / (metrics.hits + metrics.misses) * 100 : 0,
    ops: Math.round((metrics.operations - prior.operations) / elapsed),
    dbLatency: samples ? (metrics.dbMs - prior.dbMs) / samples : null,
    hits: dh, misses: dm, totals: { ...metrics }, cache: cache.snapshot(), logs: logs.slice(-25)
  }); prior = { ...metrics }; lastTick = now;
}, 800);
app.get('/api/metrics', (_, res) => res.json({ ...metrics, node: hostname(), cache: cache.snapshot(), cacheCoherent: coherent, cacheEnabled: enabled }));
app.use((error, _, res, __) => { log(`ERROR ${error.message}`); res.status(error.status ?? (error.type === 'entity.parse.failed' ? 400 : 500)).json({ error: error.status || error.type === 'entity.parse.failed' ? error.message : 'Service unavailable; retry with the same idempotency key' }); });
http.listen(port, '0.0.0.0', () => console.log(`ApexEngine ${role} on :${port}`));
async function shutdown() {
  if (stopping) return; stopping = true; coherent = false; clearInterval(telemetry);
  const deadline = setTimeout(() => process.exit(1), 15000); deadline.unref();
  await new Promise(resolve => io.close(resolve)); await watcher?.close(); await store.close(); clearTimeout(deadline);
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
