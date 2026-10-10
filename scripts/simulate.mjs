// Real REST writes to the simulated market; no invented live metrics.
import { randomUUID } from 'node:crypto';
const base = process.env.API_URL ?? 'http://localhost:8080'; let stopped = false;
process.on('SIGINT', () => { stopped = true; });
const bases = { BTC_USDT: 6724500, ETH_USDT: 345000, SOL_USDT: 15800, AAPL: 22500, MSFT: 43500, NVDA: 13500 };
let n = 0;
while (!stopped) {
  const symbol = Object.keys(bases)[n % 6], side = Math.floor(n / 6) % 2 ? 'buy' : 'sell'; n++;
  const body = { symbol, side, priceCents: bases[symbol], quantity: 1 + n % 3 }, key = randomUUID();
  try {
    const r = await fetch(`${base}/api/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
    console.log(r.status, symbol, side, await r.text());
    await fetch(`${base}/api/book/${symbol}`, { signal: AbortSignal.timeout(5000) });
  } catch (e) { console.error(e.message); }
  await new Promise(resolve => setTimeout(resolve, 800));
}
