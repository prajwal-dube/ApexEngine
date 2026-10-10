# Verification report

Recorded during project creation on 10 October 2026 UTC (11 October in India).

## Executed successfully

| Check | Result |
|---|---|
| Dependency installation | npm workspace install succeeded; package-lock.json included |
| Algorithm tests | 11 passed, 0 failed |
| Randomized LFU verification | 10,000 seeded operations compared against a simple reference cache, including pointer and frequency invariants |
| Matching conservation | 500 seeded order submissions; quantity conserved and book remains uncrossed |
| Frontend production build | Vite build succeeded; runtime/chart/app chunks split |
| Backend JavaScript syntax | Node syntax checks succeeded |
| Database initialization script syntax | bash -n succeeded |
| Deployment YAML parsing | Compose plus all Kubernetes YAML files parsed successfully; this is syntax-level verification |
| Dependency audit | npm audit returned 0 known vulnerabilities at verification time |
| LFU microbenchmark | 500,000 get operations measured; raw output in sample-cache-benchmark.json |
| Frontend development server | Started successfully on local loopback using Vite |

The algorithm tests use the built-in Node test runner. No database is required for them. The cache and matcher include tests of behavior/invariants rather than only examples mirroring the implementation.

## Not completed in this environment

- Docker is not installed here, so container builds and Compose startup were not executed.
- Kubernetes deployment, rollout behavior and HPA scaling were not exercised.
- A temporary MongoDB 7.0 replica-set launch was attempted, but MongoDB exited with `open: Operation not permitted` in this execution runtime. Consequently, real-Mongo transaction, Socket.io change-stream delivery, and HTTP integration checks were not executed here.
- Automated browser interaction and visual QA were attempted. The available browser runtime lacked its executable, and browser downloads returned invalid archives. No browser screenshot, rendering/FPS test or mobile interaction pass is claimed.
- No end-to-end HTTP benchmark, cache on/off database comparison, cluster failover test or server resource measurement is claimed.

These limitations are recorded explicitly so build success is not confused with full runtime deployment verification. The project includes the missing run commands and HTTP/Socket.io integration tests for your machine.

## Run locally before your interview

```bash
npm ci
npm test
npm run build
docker compose up --build -d
npm run test:integration
node scripts/simulate.mjs
```

Then open the dashboard, select Live, verify order acknowledgements and book updates, repeatedly read one market to warm the cache, read all six to observe eviction, and inspect `docker compose logs`.

Use `node scripts/load.mjs` against a single gateway for a real HTTP benchmark. Record CPU/RAM separately with `docker stats`. For Kubernetes, follow README section 14 and explicitly test writer downtime/reconnection behavior instead of claiming zero downtime from a rolling-update field alone.

## Microbenchmark interpretation

`sample-cache-benchmark.json` records a single synchronous LFU get-only run with a no-op event callback, capacity 1,000, a repeated 1,200-key access cycle, and 50,000 warmup operations. It describes one shared execution environment and is not a reproducibility guarantee. It excludes API routing, logging, database work, serialization, sockets and rendering. Do not quote it as real request throughput or as a production capacity estimate.

The JSON includes runtime, hardware description, elapsed time, operation count, hit count, process CPU counters and memory. A host CPU model is descriptive; a shared/sandboxed environment can limit resources. Repeat representative workloads on your own machine before adding performance numbers to your resume.
