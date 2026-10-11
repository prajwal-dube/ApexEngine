// A frequency bucket is an insertion-ordered doubly linked list.
// Its sentinels let append and remove operate without edge-case branches.
export class List {
  constructor() {
    this.head = { prev: null, next: null };
    this.tail = { prev: this.head, next: null };
    this.head.next = this.tail; this.size = 0;
  }

  // Insert immediately before the tail: the newest item in this frequency.
  append(node) {
    node.prev = this.tail.prev; node.next = this.tail;
    node.prev.next = node; this.tail.prev = node;
    this.size++;
  }

  // Unlink a known member in O(1), preserving the order of its neighbors.
  remove(node) {
    node.prev.next = node.next; node.next.prev = node.prev;
    node.prev = null; node.next = null; this.size--;
  }

  // LFU ties are broken by recency: evict the oldest node in the bucket.
  shift() {
    if (!this.size) return undefined;
    const node = this.head.next; this.remove(node); return node;
  }

  // Useful for diagnostics and invariant tests; not used by cache hot paths.
  *nodes() { for (let n = this.head.next; n !== this.tail; n = n.next) yield n; }
}
