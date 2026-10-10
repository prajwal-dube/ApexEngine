import { List } from './list.js';
export class LFUCache {
  constructor(capacity, onEvent = () => {}, onEvict = () => {}) {
    if (!Number.isInteger(capacity) || capacity < 0) throw new Error('Invalid capacity');
    this.capacity = capacity; this.onEvent = onEvent; this.onEvict = onEvict; this.clear();
  }
  clear() { this.entries = new Map(); this.buckets = new Map(); this.minFreq = 0; }
  bucket(frequency) {
    if (!this.buckets.has(frequency)) this.buckets.set(frequency, new List());
    return this.buckets.get(frequency);
  }
  touch(node) {
    const old = node.freq, list = this.buckets.get(old); list.remove(node);
    if (!list.size) {
      this.buckets.delete(old);
      if (this.minFreq === old) this.minFreq = old + 1;
    }
    node.freq++; this.bucket(node.freq).append(node);
  }
  get(key) {
    const node = this.entries.get(key);
    if (!node) return undefined;
    this.touch(node); this.onEvent(`LFU HIT ${key} (Freq: ${node.freq})`);
    return node.value;
  }
  put(key, value) {
    if (!this.capacity) return;
    const existing = this.entries.get(key);
    if (existing) { existing.value = value; this.touch(existing); return; }
    if (this.entries.size === this.capacity) {
      const list = this.buckets.get(this.minFreq), victim = list.shift();
      this.entries.delete(victim.key); this.onEvict(victim.key);
      if (!list.size) this.buckets.delete(this.minFreq);
      this.onEvent(`CACHE EVICT ${victim.key} (Freq: ${victim.freq}) — LFU capacity`);
    }
    const node = { key, value, freq: 1, prev: null, next: null };
    this.entries.set(key, node); this.bucket(1).append(node); this.minFreq = 1;
    this.onEvent(`LFU PUT ${key} (Freq: 1)`);
  }
  // Arbitrary invalidation can leave gaps in frequencies. Recomputing minimum
  // is O(number of buckets); get/put and capacity eviction stay expected O(1).
  delete(key) {
    const node = this.entries.get(key); if (!node) return false;
    const list = this.buckets.get(node.freq); list.remove(node); this.entries.delete(key);
    if (!list.size) {
      this.buckets.delete(node.freq);
      if (this.minFreq === node.freq) { let minimum = Infinity; for (const freq of this.buckets.keys()) minimum = Math.min(minimum, freq); this.minFreq = this.buckets.size ? minimum : 0; }
    }
    return true;
  }
  snapshot() {
    return [...this.entries.values()].map(({ key, freq }) => ({ key, freq }));
  }
}
