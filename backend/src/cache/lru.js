import { List } from './list.js';
export class LRUCache {
  constructor(capacity) {
    if (!Number.isInteger(capacity) || capacity < 0) throw new Error('Invalid capacity');
    this.capacity = capacity; this.clear();
  }
  clear() { this.entries = new Map(); this.list = new List(); }
  get(key) {
    const n = this.entries.get(key); if (!n) return undefined;
    this.list.remove(n); this.list.append(n); return n.value;
  }
  put(key, value) {
    if (!this.capacity) return;
    const n = this.entries.get(key);
    if (n) { n.value = value; this.list.remove(n); this.list.append(n); return; }
    if (this.entries.size === this.capacity) this.entries.delete(this.list.shift().key);
    const node = { key, value }; this.entries.set(key, node); this.list.append(node);
  }
  delete(key) {
    const n = this.entries.get(key); if (!n) return false;
    this.list.remove(n); return this.entries.delete(key);
  }
}
