const { spawnSync } = require('node:child_process');
const { readFile } = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');

const projectRoot = __dirname;
const apiUrl = 'http://localhost:4000';
const readinessTimeoutMs = 60_000;
let mongoPort;

function run(command, args, env = {}) {
  console.log(`\n> ${[command, ...args].join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: { ...process.env, ...env },
    stdio: 'inherit'
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? 'unknown'}`);
  }
}

const compose = (args, cacheEnabled) => run(
  'docker',
  ['compose', ...args],
  { CACHE_ENABLED: String(cacheEnabled), MONGO_PORT: String(mongoPort) }
);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function isPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', error => {
      if (error.code === 'EADDRINUSE') resolve(false);
      else reject(error);
    });
    server.listen(port, '127.0.0.1', () => {
      server.close(error => error ? reject(error) : resolve(true));
    });
  });
}

async function selectMongoPort() {
  const requestedPort = process.env.MONGO_PORT ? Number(process.env.MONGO_PORT) : null;
  if (requestedPort !== null) {
    if (!Number.isInteger(requestedPort) || requestedPort < 1 || requestedPort > 65535) {
      throw new Error('MONGO_PORT must be an integer between 1 and 65535.');
    }
    if (!await isPortAvailable(requestedPort)) {
      throw new Error(`MONGO_PORT ${requestedPort} is already in use.`);
    }
    return requestedPort;
  }

  for (let port = 27017; port <= 27117; port++) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error('No available MongoDB host port found in the range 27017–27117.');
}

async function waitForBackend(cacheEnabled) {
  const deadline = Date.now() + readinessTimeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const healthResponse = await fetch(`${apiUrl}/health/ready`, {
        signal: AbortSignal.timeout(2_000)
      });
      const metricsResponse = await fetch(`${apiUrl}/api/metrics`, {
        signal: AbortSignal.timeout(2_000)
      });
      if (!healthResponse.ok || !metricsResponse.ok) {
        throw new Error(`API returned HTTP ${healthResponse.status}/${metricsResponse.status}`);
      }

      const health = await healthResponse.json();
      const metrics = await metricsResponse.json();
      if (
        health.ok === true &&
        health.role === 'gateway' &&
        metrics.cacheEnabled === cacheEnabled &&
        metrics.cacheCoherent === true
      ) return;

      throw new Error(
        `Gateway not ready for cache-${cacheEnabled ? 'on' : 'off'} ` +
        `(cacheEnabled=${metrics.cacheEnabled}, cacheCoherent=${metrics.cacheCoherent})`
      );
    } catch (error) {
      lastError = error;
      await sleep(1_000);
    }
  }

  throw new Error(`Gateway did not become ready within ${readinessTimeoutMs / 1000}s: ${lastError}`);
}

function readMetric(result, key, predicate = Number.isFinite) {
  const value = key.split('.').reduce((current, part) => current?.[part], result);
  if (!predicate(value)) throw new Error(`Invalid or missing benchmark metric: ${key}`);
  return value;
}

async function readResult(fileName, expectedCacheEnabled) {
  const filePath = path.join(projectRoot, fileName);
  let result;
  try {
    result = JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read valid JSON from ${fileName}: ${error.message}`);
  }

  if (result.cacheEnabled !== expectedCacheEnabled) {
    throw new Error(
      `${fileName} reports cacheEnabled=${result.cacheEnabled}; expected ${expectedCacheEnabled}`
    );
  }
  readMetric(result, 'successes', value => Number.isInteger(value) && value > 0);
  readMetric(result, 'errors', value => Number.isInteger(value) && value >= 0);
  readMetric(result, 'attempts', value => Number.isInteger(value) && value > 0);
  readMetric(result, 'databaseReadsDelta', value => Number.isFinite(value) && value >= 0);
  readMetric(result, 'durationSeconds', value => Number.isFinite(value) && value > 0);
  readMetric(result, 'concurrency', value => Number.isInteger(value) && value > 0);
  readMetric(result, 'successfulRequestsPerSecond', value => Number.isFinite(value) && value >= 0);
  readMetric(result, 'samples', value => Number.isInteger(value) && value > 0);
  if (result.successes + result.errors !== result.attempts) {
    throw new Error(`${fileName} has inconsistent attempt, success, and error counts.`);
  }
  for (const percentile of ['p50', 'p95', 'p99']) {
    readMetric(result, `latencyMs.${percentile}`, value => Number.isFinite(value) && value >= 0);
  }
  return result;
}

function format(value, decimals = 2) {
  return Number(value).toFixed(decimals);
}

function reductionPercent(withCache, withoutCache) {
  return withoutCache === 0 ? null : (withoutCache - withCache) / withoutCache * 100;
}

function describeReduction(withCache, withoutCache) {
  const reduction = reductionPercent(withCache, withoutCache);
  if (reduction === null) return 'not measurable';
  if (reduction > 0) return `${format(reduction, 4)}% fewer`;
  if (reduction < 0) return `${format(Math.abs(reduction), 4)}% more`;
  return 'no change';
}

function describeLatencyChange(withCache, withoutCache) {
  const reduction = reductionPercent(withCache, withoutCache);
  if (reduction === null) {
    const delta = withCache - withoutCache;
    return `Δ ${delta >= 0 ? '+' : ''}${format(delta)} ms`;
  }
  if (reduction > 0) return `${format(reduction, 4)}% lower with cache`;
  if (reduction < 0) return `${format(Math.abs(reduction), 4)}% higher with cache`;
  return 'no change';
}

async function reportResults() {
  const [cacheOn, cacheOff] = await Promise.all([
    readResult('cache-on.json', true),
    readResult('cache-off.json', false)
  ]);

  if (
    cacheOn.durationSeconds !== cacheOff.durationSeconds ||
    cacheOn.concurrency !== cacheOff.concurrency ||
    cacheOn.api !== cacheOff.api
  ) {
    throw new Error('The two runs used different API, duration, or concurrency settings.');
  }

  const meanReadsOn = cacheOn.databaseReadsDelta / cacheOn.successes;
  const meanReadsOff = cacheOff.databaseReadsDelta / cacheOff.successes;
  const latencyComparisons = ['p50', 'p95', 'p99'].map(percentile => {
    const on = cacheOn.latencyMs[percentile];
    const off = cacheOff.latencyMs[percentile];
    return `${percentile} ${format(off)}→${format(on)} ms ` +
      `(${describeLatencyChange(on, off)})`;
  });
  const throughputOn = cacheOn.successfulRequestsPerSecond;
  const throughputOff = cacheOff.successfulRequestsPerSecond;
  if (!Number.isFinite(throughputOn) || !Number.isFinite(throughputOff)) {
    throw new Error('Invalid or missing successfulRequestsPerSecond metric.');
  }

  console.log('\nResume-ready benchmark bullets (Specialist Programmer; use only with the run context):');
  console.log(
    `- Benchmarked ApexEngine book reads: cache-on averaged ${format(meanReadsOn, 4)} ` +
    `database reads per successful request vs ${format(meanReadsOff, 4)} cache-off ` +
    `(${describeReduction(meanReadsOn, meanReadsOff)}).`
  );
  console.log(
    `- Compared cache-off→cache-on attempt latency: ${latencyComparisons.join('; ')}.`
  );
  console.log(
    `- Measured ${format(throughputOn)} vs ${format(throughputOff)} successful requests/s ` +
    `at ${cacheOn.concurrency} concurrent workers for ${cacheOn.durationSeconds}s; ` +
    `errors: ${cacheOn.errors}/${cacheOn.attempts} cache-on, ` +
    `${cacheOff.errors}/${cacheOff.attempts} cache-off.`
  );
}

async function main() {
  let restoreRequired = false;
  let taskError;
  let restoreError;

  try {
    mongoPort = await selectMongoPort();
    restoreRequired = true;
    console.log(`Using MongoDB host port ${mongoPort}.`);
    compose(['up', '-d', '--force-recreate', 'engine', 'gateway'], true);
    compose(['up', '-d', 'frontend'], true);
    console.log('\nWaiting 5 seconds for the cache-on stack to warm up...');
    await sleep(5_000);
    await waitForBackend(true);
    run(process.execPath, [path.join(projectRoot, 'scripts', 'load.mjs')], {
      API_URL: apiUrl,
      RESULT_FILE: 'cache-on.json'
    });

    compose(['up', '-d', '--force-recreate', 'engine', 'gateway'], false);
    console.log('\nWaiting 5 seconds for the cache-off stack to stabilize...');
    await sleep(5_000);
    await waitForBackend(false);
    run(process.execPath, [path.join(projectRoot, 'scripts', 'load.mjs')], {
      API_URL: apiUrl,
      RESULT_FILE: 'cache-off.json'
    });
  } catch (error) {
    taskError = error;
  } finally {
    if (restoreRequired) {
      try {
        console.log('\nRestoring the primary cache-on environment...');
        compose(['up', '-d', '--force-recreate', 'engine', 'gateway'], true);
        await waitForBackend(true);
        restoreRequired = false;
      } catch (error) {
        restoreError = error;
      }
    }
  }

  if (taskError || restoreError) {
    if (taskError) console.error(`\nBenchmark failed: ${taskError.message}`);
    if (restoreError) console.error(`\nCache-on restoration failed: ${restoreError.message}`);
    process.exitCode = 1;
    return;
  }

  try {
    await reportResults();
  } catch (error) {
    console.error(`\nCould not produce benchmark summary: ${error.message}`);
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
