import { LRUCache } from './lru.js';
import { LFUCache } from './lfu.js';
export class TieredCache {
  constructor(lruCapacity, lfuCapacity, event = () => {}) {
    this.l1 = new LRUCache(lruCapacity); this.event = event;
    // Structured eviction callback preserves arbitrary keys without parsing logs.
    this.l2 = new LFUCache(lfuCapacity, event, key => this.l1.delete(key));
  }
  get(key) {
    const recent = this.l1.get(key);
    // Every access promotes LFU frequency, including L1 hits.
    const value = this.l2.get(key);
    if (value !== undefined) { this.l1.put(key, value); return { value, tier: recent !== undefined ? 'L1' : 'L2' }; }
    return undefined;
  }
  put(key, value) { this.l2.put(key, value); if (this.l2.entries.has(key)) this.l1.put(key, value); }
  delete(key) { this.l1.delete(key); this.l2.delete(key); this.event(`CACHE INVAL ${key}`); }
  clear() { this.l1.clear(); this.l2.clear(); }
  snapshot() { return this.l2.snapshot(); }
}
