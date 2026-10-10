// Requires a running Compose cluster, and intentionally writes simulated orders.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base = process.env.API_URL ?? 'http://localhost:8080';
const post = (key, body) => fetch(`${base}/api/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body) });
test('HTTP idempotency, conflict, durable lookup and hot reads', async () => {
  const key = randomUUID(), body = { symbol: 'SOL_USDT', side: 'buy', priceCents: 1, quantity: 1 };
  const [a, b] = await Promise.all([post(key, body), post(key, body)]); assert.equal(a.status, 201); assert.equal(b.status, 201);
  assert.deepEqual(await a.json(), await b.json());
  const conflict = await post(key, { ...body, quantity: 2 }); assert.equal(conflict.status, 409);
  const lookup = await fetch(`${base}/api/orders/${key}`); assert.equal(lookup.status, 200); assert.equal((await lookup.json()).id, key);
  for (let i = 0; i < 20; i++) { const r = await fetch(`${base}/api/book/SOL_USDT`); assert.equal(r.status, 200); assert.equal((await r.json()).symbol, 'SOL_USDT'); }
  const malformed = await post(randomUUID(), { ...body, quantity: -1 }); assert.equal(malformed.status, 400);
});

test('Socket.io subscription receives a committed book update', { timeout: 15000 }, async () => {
  const { io } = await import('socket.io-client');
  const socket = io(base, { transports: ['websocket'], autoConnect: false, reconnection: false });
  try {
    const initial = new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('Initial socket snapshot timed out')), 5000);
      socket.once('connect_error', error => { clearTimeout(deadline); reject(error); });
      socket.once('book:update', book => { clearTimeout(deadline); resolve(book); });
      socket.once('connect', () => socket.emit('subscribe', 'MSFT'));
    });
    socket.connect(); const first = await initial;
    assert.equal(first.symbol, 'MSFT');
    const update = new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('Committed socket update timed out')), 5000);
      socket.on('book:update', book => { if (book.symbol === 'MSFT' && book.revision > first.revision) { clearTimeout(deadline); resolve(book); } });
    });
    const response = await post(randomUUID(), { symbol: 'MSFT', side: 'buy', priceCents: 1, quantity: 1 });
    assert.equal(response.status, 201);
    const receipt = await response.json(); const changed = await update;
    assert.ok(changed.revision >= receipt.revision);
  } finally { socket.removeAllListeners(); socket.disconnect(); }
});
