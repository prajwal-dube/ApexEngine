import { List } from './list.js';

/**
 * Least Frequently Used cache with least-recently-used tie breaking.
 *
 * `entries` maps each key to its node. `buckets` maps a frequency to the
 * insertion-ordered list of nodes at that frequency. `minFreq` points at
 * the only bucket needed to evict an item.
 *
 * Under JavaScript Map's standard average O(1) lookup/insert semantics,
 * get, put, promotion, and capacity eviction take O(1) time.
 */
export class LFUCache {
  constructor(capacity, onEvent = () => {}, onEvict = () => {}) {
    if (!Number.isInteger(capacity) || capacity < 0) {
      throw new Error('Invalid capacity');
    }

    this.capacity = capacity;
    this.onEvent = onEvent;
    this.onEvict = onEvict;
    this.clear();
  }

  // Reset all index structures together so their invariants stay aligned.
  clear() {
    this.entries = new Map();
    this.buckets = new Map();
    this.minFreq = 0;
  }

  // Return the frequency bucket, creating it only when first needed.
  bucket(frequency) {
    let list = this.buckets.get(frequency);
    if (!list) {
      list = new List();
      this.buckets.set(frequency, list);
    }
    return list;
  }

  /**
   * Record one access to a cached node.
   *
   * Moving a node from frequency f to f + 1 only touches two lists and a
   * fixed number of pointers. If the old minimum bucket empties, this node
   * itself guarantees that f + 1 is the new minimum.
   */
  _promote(node) {
    const previousFrequency = node.freq;
    const previousBucket = this.buckets.get(previousFrequency);

    // The node is known to be indexed in this bucket through `entries`.
    previousBucket.remove(node);

    if (previousBucket.size === 0) {
      this.buckets.delete(previousFrequency);

      if (this.minFreq === previousFrequency) {
        this.minFreq = previousFrequency + 1;
      }
    }

    node.freq = previousFrequency + 1;
    this.bucket(node.freq).append(node);
  }

  /**
   * Return the value for key, or undefined when it is not cached.
   * A successful read promotes the entry's frequency and recency.
   */
  get(key) {
    const node = this.entries.get(key);
    if (!node) return undefined;

    this._promote(node);
    this.onEvent(`LFU HIT ${key} (Freq: ${node.freq})`);
    return node.value;
  }

  /**
   * Insert or update a value.
   *
   * Updating an existing key counts as an access. A new key starts at
   * frequency one, so it becomes the new minimum-frequency entry.
   */
  put(key, value) {
    if (this.capacity === 0) return;

    const existing = this.entries.get(key);
    if (existing) {
      existing.value = value;
      this._promote(existing);
      return;
    }

    if (this.entries.size === this.capacity) {
      const evictionBucket = this.buckets.get(this.minFreq);
      const victim = evictionBucket.shift();

      this.entries.delete(victim.key);
      if (evictionBucket.size === 0) {
        this.buckets.delete(this.minFreq);
      }

      // Keep the cache internally consistent before invoking user callbacks.
      this.onEvict(victim.key);
      this.onEvent(
        `CACHE EVICT ${victim.key} (Freq: ${victim.freq}) — LFU capacity`
      );
    }

    const node = {
      key,
      value,
      freq: 1,
      prev: null,
      next: null
    };

    this.entries.set(key, node);
    this.bucket(1).append(node);
    this.minFreq = 1;
    this.onEvent(`LFU PUT ${key} (Freq: 1)`);
  }

  /**
   * Remove a key without recording an access.
   *
   * Arbitrary invalidation can empty the minimum bucket while leaving a gap
   * between the remaining frequencies. Finding the next minimum therefore
   * scans the frequency buckets; this method is O(number of buckets), while
   * get, put, promotion, and capacity eviction remain O(1).
   */
  delete(key) {
    const node = this.entries.get(key);
    if (!node) return false;

    const frequency = node.freq;
    const list = this.buckets.get(frequency);
    list.remove(node);
    this.entries.delete(key);

    if (list.size === 0) {
      this.buckets.delete(frequency);

      if (this.minFreq === frequency) {
        let nextMinimum = Infinity;
        for (const bucketFrequency of this.buckets.keys()) {
          nextMinimum = Math.min(nextMinimum, bucketFrequency);
        }
        this.minFreq = this.buckets.size === 0 ? 0 : nextMinimum;
      }
    }

    return true;
  }

  // Return a detached summary so callers cannot mutate internal nodes.
  snapshot() {
    return [...this.entries.values()].map(({ key, freq }) => ({ key, freq }));
  }
}
