import test from 'node:test';
import assert from 'node:assert/strict';
import { LFUCache } from '../src/cache/lfu.js';
import { LRUCache } from '../src/cache/lru.js';
import { TieredCache } from '../src/cache/tiered.js';
function invariant(cache) {
  const seen = new Set();
  for (const [f, list] of cache.buckets) {
    assert.ok(list.size > 0); let size = 0, prev = list.head;
    for (const node of list.nodes()) { assert.equal(node.prev, prev); assert.equal(node.freq, f); assert.equal(cache.entries.get(node.key), node); assert.ok(!seen.has(node.key)); seen.add(node.key); prev = node; size++; }
    assert.equal(list.tail.prev, prev); assert.equal(size, list.size);
  }
  assert.equal(seen.size, cache.entries.size);
  assert.equal(cache.minFreq, cache.entries.size ? Math.min(...[...cache.entries.values()].map(n => n.freq)) : 0);
}
test('LFU retains frequent item and evicts least frequent', () => {
  const c = new LFUCache(2); c.put('a', 10); c.put('b', 20); c.get('a'); c.put('c', 30);
  assert.equal(c.get('b'), undefined); assert.equal(c.get('a'), 10); assert.equal(c.get('c'), 30); invariant(c);
});
test('LFU breaks equal-frequency ties by oldest access', () => {
  const c = new LFUCache(2); c.put('a', 1); c.put('b', 2); c.get('a'); c.get('b'); c.put('c', 3);
  assert.equal(c.get('a'), undefined); assert.equal(c.get('b'), 2); invariant(c);
});
test('updates count as access, frequency gaps survive invalidation', () => {
  const c = new LFUCache(3); c.put('a', 1); c.put('b', 2); c.put('c', 3); for (let i = 0; i < 9; i++) c.get('b'); c.put('c', 33); c.delete('a');
  assert.equal(c.minFreq, 2); c.delete('c'); assert.equal(c.minFreq, 10); assert.equal(c.get('b'), 2); invariant(c);
});
test('zero capacity, falsey values and invalid configuration', () => {
  const c = new LFUCache(0); c.put('x', 1); assert.equal(c.get('x'), undefined);
  const d = new LFUCache(2); d.put('zero', 0); d.put('false', false); assert.equal(d.get('zero'), 0); assert.equal(d.get('false'), false);
  assert.throws(() => new LFUCache(-1)); assert.throws(() => new LRUCache(1.5));
});
test('LRU refreshes recency and tiered cache counts L1 hits in LFU', () => {
  const l = new LRUCache(2); l.put('a', 1); l.put('b', 2); l.get('a'); l.put('c', 3); assert.equal(l.get('b'), undefined);
  const c = new TieredCache(1, 2); c.put('a', 1); c.put('b', 2); assert.equal(c.get('a').tier, 'L2'); assert.equal(c.get('a').tier, 'L1');
  assert.equal(c.l2.entries.get('a').freq, 3); c.put('c', 3); assert.equal(c.get('b'), undefined); c.delete('a'); assert.equal(c.get('a'), undefined);
});
test('LFU matches a simple reference model for 10,000 seeded operations', () => {
  const c = new LFUCache(7), ref = new Map(); let tick = 0, seed = 42;
  const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  for (let i = 0; i < 10000; i++) {
    const key = `k${rand() % 13}`, operation = rand() % 5; tick++;
    if (operation < 2) {
      const entry = ref.get(key); assert.equal(c.get(key), entry?.value); if (entry) { entry.freq++; entry.at = tick; }
    } else if (operation < 4) {
      const value = rand(), entry = ref.get(key);
      if (entry) { entry.value = value; entry.freq++; entry.at = tick; }
      else {
        if (ref.size === 7) { const victim = [...ref].sort((a,b) => a[1].freq - b[1].freq || a[1].at - b[1].at)[0][0]; ref.delete(victim); }
        ref.set(key, { value, freq: 1, at: tick });
      } c.put(key, value);
    } else { assert.equal(c.delete(key), ref.delete(key)); }
    invariant(c); assert.deepEqual([...c.entries.keys()].sort(), [...ref.keys()].sort());
  }
});
