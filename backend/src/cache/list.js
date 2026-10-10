// Sentinel nodes eliminate null-pointer branches in the hot path.
export class List {
  constructor() {
    this.head = { next: null }; this.tail = { prev: this.head };
    this.head.next = this.tail; this.size = 0;
  }
  append(node) {
    node.prev = this.tail.prev; node.next = this.tail;
    this.tail.prev.next = node; this.tail.prev = node; this.size++;
  }
  remove(node) {
    node.prev.next = node.next; node.next.prev = node.prev;
    node.prev = null; node.next = null; this.size--;
  }
  shift() {
    if (!this.size) return undefined;
    const node = this.head.next; this.remove(node); return node;
  }
  *nodes() { for (let n = this.head.next; n !== this.tail; n = n.next) yield n; }
}
