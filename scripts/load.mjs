// Bounded HTTP read load. Run against the same gateway with cache on/off separately.
import { performance } from 'node:perf_hooks';
import { cpus, platform } from 'node:os';
import { writeFile } from 'node:fs/promises';
const base = process.env.API_URL ?? 'http://localhost:8080', duration = Number(process.env.DURATION_SECONDS ?? 15), concurrency = Number(process.env.CONCURRENCY ?? 10);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 200 || !Number.isFinite(duration) || duration < 1 || duration > 600) throw new Error('CONCURRENCY=1–200; DURATION_SECONDS=1–600');
const before = await fetch(`${base}/api/metrics`).then(r => r.json());
const latencies = []; let successes = 0, errors = 0, attempts = 0; const cpu = process.cpuUsage(), start = performance.now(), end = start + duration * 1000;
await Promise.all(Array.from({ length: concurrency }, async (_, worker) => {
  let i = worker;
  while (performance.now() < end) {
    const symbol = i++ % 10 < 8 ? 'BTC_USDT' : i % 2 ? 'ETH_USDT' : 'SOL_USDT'; const t = performance.now();
    try { const r = await fetch(`${base}/api/book/${symbol}`, { signal: AbortSignal.timeout(5000) }); await r.arrayBuffer(); r.ok ? successes++ : errors++; } catch { errors++; }
    attempts++; if (latencies.length < 200000) latencies.push(performance.now() - t);
  }
}));
const elapsed = (performance.now() - start) / 1000, after = await fetch(`${base}/api/metrics`).then(r => r.json());
latencies.sort((a,b) => a - b); const pct = p => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] ?? null;
const result = { at: new Date().toISOString(), api: base, durationSeconds: duration, elapsedSeconds: elapsed, concurrency, attempts, successes, errors, errorRate: errors / attempts, successfulRequestsPerSecond: successes / elapsed, latencyMs: { p50: pct(.5), p95: pct(.95), p99: pct(.99) }, samples: latencies.length, samplePolicy: 'first 200000 completed attempts, includes failures', cacheEnabled: after.cacheEnabled, gateway: after.node, databaseReadsDelta: after.dbReads - before.dbReads, cacheHitsDelta: after.hits - before.hits, processMeasurementScope: 'load client only; collect server CPU/RAM separately with docker stats', client: { node: process.version, cpu: cpus()[0]?.model, platform: platform(), cpuMicroseconds: process.cpuUsage(cpu), memory: process.memoryUsage() } };
const name = process.env.RESULT_FILE ?? 'benchmark-results-http.json'; await writeFile(name, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
