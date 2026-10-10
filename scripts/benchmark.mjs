import { performance } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';
import { cpus, totalmem, platform } from 'node:os';
import { LFUCache } from '../backend/src/cache/lfu.js';
const count = Number(process.env.BENCH_OPS ?? 500000);
if (!Number.isSafeInteger(count) || count < 1 || count > 10000000) throw new Error('BENCH_OPS must be 1–10000000');
const c = new LFUCache(1000); for (let i = 0; i < 1000; i++) c.put(i, { value: i });
for (let i = 0; i < 50000; i++) c.get(i % 1200);
const cpuStart = process.cpuUsage(), start = performance.now(); let hits = 0;
for (let i = 0; i < count; i++) { if (c.get(i % 1200) !== undefined) hits++; }
const elapsedMs = performance.now() - start;
const result = { kind: 'LFU synchronous microbenchmark, not HTTP or database throughput', at: new Date().toISOString(), node: process.version, platform: platform(), cpu: cpus()[0]?.model, cpuCount: cpus().length, totalMemoryBytes: totalmem(), operations: count, hits, elapsedMs, operationsPerSecond: Math.round(count / elapsedMs * 1000), cpuUsageMicroseconds: process.cpuUsage(cpuStart), memory: process.memoryUsage(), workload: 'capacity=1000; round-robin 1200 keys; 50000 warmup gets; get only' };
await writeFile('benchmark-results-cache.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
