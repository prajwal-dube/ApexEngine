# ApexEngine: Infosys interview preparation

Use this guide to understand your implementation and explain it in your own words. It is preparation material, not a script to memorize word for word. Read the cache and matching code before the interview.

## Your 60–90 second introduction

“ApexEngine is an educational order-book platform I built to connect backend engineering with data structures. Users submit simulated buy or sell limit orders through Express APIs. A single matching service applies price and arrival priority, and MongoDB transactions persist the book, orders and trades together.

Repeated book reads go through a custom cache. I implemented an LFU cache with Hash Maps and doubly linked frequency lists, using LRU to break equal-frequency ties. I also added an LRU recent-access tier. The ordinary get and put paths have expected constant-time cache operations.

Socket.io sends book snapshots and actual backend telemetry to a React dashboard. I batch display updates every 800 milliseconds and cap the chart and logs. Docker Compose reproduces the complete environment, and I included Kubernetes configurations for a single writer and replicated gateways. The most interesting design problem was keeping per-process cached snapshots consistent after writes, which I address using committed MongoDB change events and cache invalidation.”

If you have only run Docker, say Docker was run and Kubernetes manifests were prepared. If the work is an independent project, say so. Describe the internship connection only if it is historically accurate.

## Five things to be able to explain without notes

1. Why a hash map plus a doubly linked list avoids searching for the predecessor.
2. Why a stock's frequency and recency are different signals.
3. Why a write must commit before its success is reported.
4. Why every gateway must receive invalidation; sticky sessions aren't a substitute.
5. Why 800ms batched display updates help and do not prove 60 FPS.

## Questions you are likely to get

### What is the difference between LRU and LFU?

LRU cares about the time of the most recent access. LFU cares about access counts. A one-time recently read item can displace a popular item in LRU; LFU tends to protect popular items but can retain old popularity without aging. This project uses LFU eviction and recency to break ties.

### Walk me through your LFU `get` method.

Look up the node. Detach it from its old frequency list. Delete that list if empty, and advance the minimum if needed. Increase the frequency. Append the node to the new frequency list and return the value. Touch only a constant number of pointers and map entries.

### Walk me through `put` when the cache is full.

If the key already exists, update its value and treat it as an access. For a new key, take the oldest node from the minimum-frequency bucket, remove it from the entries map, and insert the new key into frequency 1. Reset the minimum to 1.

### Why can `minFreq` advance by exactly one during a get?

The accessed node moves from frequency f to f+1. If the frequency-f bucket was the minimum and becomes empty, the moved node guarantees an f+1 bucket exists. No lower bucket exists, so f+1 is the new minimum.

### Does arbitrary invalidation remain O(1)?

Not always in this implementation. Deleting the last node in the minimum bucket can leave frequency gaps, so we scan existing bucket keys for the new minimum. That's O(F). Ordinary get, put and capacity eviction remain expected O(1). This is a precise limitation worth knowing.

### Does your implementation minimize garbage collection spikes?

It avoids scanning entries in normal eviction but does not prove reduced GC pauses. Promotion can allocate lists and JavaScript owns garbage collection. I would measure GC behavior before claiming that result.

### How do your LRU and LFU tiers interact?

The small LRU tier identifies recently used snapshots; the LFU tier retains the bounded working set. Every hit still updates LFU counts, even when it hits LRU. When LFU evicts, LRU drops the same key. I treat the two policies as a clear algorithm demonstration; I haven't claimed a measured L1 speedup over LFU alone.

### How does matching work?

For a buy, inspect the lowest-priced sell. Match while its price is at or below the buy limit and the incoming quantity remains. For a sell, inspect the highest-priced buy. Execute at the resting order's price. Reduce quantities, remove fully filled resting orders, and keep any incoming remainder in the book. Within an equal price, lower arrival sequence wins.

### What is matching complexity?

The implementation clones a bounded book, uses sorted arrays, and shifts orders from the front. Sorting a remaining order into the book is O(n log n), and repeated shifts can create higher costs over many fills. It is a readable bounded simulation, not an optimized exchange matching structure. A production direction is ordered price levels plus FIFO lists, with appropriate trees/heaps and measured behavior.

### Why integer cents?

Binary floating point doesn't represent some decimal amounts exactly. Integer cents avoid this particular rounding problem. Quantities are also integers. This project doesn't support arbitrary decimal token units; that would require an explicit precision model.

### Node.js is single threaded, so why a queue?

The JavaScript callback runs on one thread, but `await` yields control. Other requests can execute while a Mongo read/write is pending. The Promise queue serializes complete matching transactions through one writer. It also has a maximum of 500 pending tasks to reject overload instead of growing without bound.

### Is the whole application single threaded?

JavaScript execution generally uses one event loop per process, but Node's runtime and dependencies can use other threads and asynchronous OS networking. Each gateway is a separate process with its own memory/cache. I don't claim that all MongoDB or Node work uses one thread.

### What is an idempotency key?

It identifies one logical submission. The transaction stores both the canonical request and original receipt. An identical retry returns the same receipt; a changed order under that key gets 409. This avoids accidentally placing a second order after an uncertain timeout. It doesn't mean the network delivers exactly once.

### What if MongoDB fails during a write?

The transaction must commit before success. A failure before commit doesn't produce an acknowledged new order. A timeout can be ambiguous, so the client retries the same key. A write already committed isn't undone just because the cache refill or socket update fails.

### What if the engine restarts?

In-memory caches disappear. Committed book/order/trade data stays in MongoDB. The next read repopulates the cache, and matching reads the stored book. Pending uncommitted requests might fail and should retry with their original keys.

### What if gateway replicas disagree?

Each has local cached values. MongoDB change streams invalidate committed changes asynchronously. A small stale window exists before notification. The submitting gateway invalidates after its receipt, but global immediate freshness isn't guaranteed. Matching always uses database state, not the cache.

### How do you prevent stale cache refill?

Remember a per-symbol generation before a DB read. A change notification increments it. When the read finishes, populate the cache only if the generation is unchanged and the stream is healthy. If a notification arrived during the read, skip filling that result.

### Why not Redis?

The goal is to demonstrate the cache algorithm directly. MongoDB change streams provide the common notification source, so no Redis is required. For some production workloads a proven external cache/broker could be appropriate, but that is a different design decision from demonstrating LFU.

### Is Socket.io the same as WebSocket?

No. Socket.io is a higher-level protocol with named events, reconnect behavior and rooms. This project configures its transport to WebSocket only. A raw WebSocket client won't understand Socket.io event framing.

### Why use a room?

A dashboard subscribes to one market. The gateway puts it in that symbol's room and sends book changes only to interested local clients. System telemetry goes to all connected local clients. Each gateway receives the Mongo changes independently.

### What happens if the browser disconnects?

It reconnects and subscribes again. The server sends a current snapshot. Intermediate monitoring updates can be lost. Durable order state is accessed through REST, so monitoring loss doesn't delete orders.

### What do you do to optimize React?

Incoming socket callbacks replace ref values rather than updating state every time. A timer applies the newest packet every 800ms. Chart/log lengths are capped, chart animation is disabled, components are memoized, and listeners/timers are cleaned up. This is bounded update work; I would measure FPS to make a frame-rate claim.

### What did Docker contribute?

Reproducible services, isolated dependencies, database replica-set initialization, health checks, a persistent volume and proxy routing. Frontend build tools don't ship in the Nginx runtime stage. Backend runtime runs as the Node user. Image size improvements aren't claimed without measurements.

### How much Kubernetes did you use?

Describe your actual execution. The repository includes foundational namespace/service/deployment/config/storage/probe manifests, three gateways, one writer, and optional HPA/Ingress. The writer uses Recreate, so the entire system isn't guaranteed zero downtime. HPA requires available resource metrics.

### Why not scale the writer to three pods?

A local Promise queue coordinates only one process. Three independent queues don't enforce one global arrival order. I would first partition symbols and add ownership/fencing, or use a durable sequencing design. More replicas alone would make the correctness story weaker.

### Why MongoDB transactions if one book is one document?

The book replacement is a single-document atomic write, but changed order states, trade records and idempotency receipt are separate documents/collections. The transaction makes those updates commit together.

### How did you test it?

The LFU cache runs 10,000 seeded random operations against a simpler reference model and checks pointers/bucket invariants. Matching tests cover priority and fills, and 500 seeded steps check quantity conservation and an uncrossed book. The HTTP integration test checks duplicate retries and conflict behavior when a replica-set database is available. Mention verification limits from the included report.

### Did you achieve millions of requests per second?

No end-to-end claim. There is a measured in-process cache microbenchmark, which excludes API/DB/socket cost. HTTP throughput must be measured separately under documented load. Dashboard Demo numbers are synthetic.

## A whiteboard exercise

Capacity 2, run `put(A,10)`, `put(B,20)`, `get(A)`, `put(C,30)`. Draw:

- entries map;
- head/tail sentinels for frequency 1 and 2;
- node previous/next links;
- minimum frequency;
- the evicted key B.

Then call `get(C)`, followed by `put(D,40)`. A and C now have frequency 2, so evict A by recency within that bucket. Explain why the minimum becomes 1 after inserting D.

## Demonstration plan, about five minutes

1. Open Demo and show the terminal/chart layout, explaining the synthetic badge.
2. Switch to Live; explain why an idle system has low/zero measured traffic.
3. Submit a resting sell and crossing buy through REST or the form.
4. Show the changed depth and order lookup.
5. Repeatedly read a symbol, then inspect hit/miss counters.
6. Read six symbols to demonstrate capacity eviction.
7. Explain the code path through LFU and the transaction.
8. Show passing tests and actual run commands, not invented performance numbers.

## Connect to core CS concepts

| Subject | Concrete connection |
|---|---|
| DSA | Hash maps, doubly linked lists, frequency grouping, FIFO, sorting complexity |
| DBMS | Transactions, atomic commits, primary reads, idempotency/audit persistence |
| Operating systems | Process-local memory, bounded working sets, event loop, asynchronous I/O |
| Computer networks | HTTP requests, persistent connections, proxy upgrades, reconnection |
| Software engineering | Separation of pure algorithms and I/O, tests, configuration, failure modes |
| DevOps | Build/runtime stages, health checks, volumes, services, deployment strategies |

The cache resembles memory replacement policy concepts, but it is an application cache rather than an OS page cache. Avoid claiming it implements CPU memory barriers, kernel paging or lock-free algorithms.

## Preparation order

Day 1: run the UI/stack and trace a read and write.

Day 2: dry-run and rewrite LRU/LFU without looking, then run the tests.

Day 3: trace partial fills and idempotent retry; practice the architecture explanation.

Day 4: run Docker, optionally run Kubernetes, and record your own workload measurements.

Before the interview: verify what you can actually defend, align historical resume wording, and keep the ZIP/repository and commands available.
