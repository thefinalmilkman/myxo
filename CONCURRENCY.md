# Nx Concurrency — `dispatch` / `gather`

> Real multi-core parallelism, built on Nx's own bones (the worker+Atomics pattern from `nx-live`).
> Honest about its shape: this is **parallelism of pure-ish, isolated tasks** — not cooperative coroutines,
> not shared-memory threads. The isolation is the feature: it is what makes the parallelism race-free.

## The model

```
dispatch f(args...)     ->  an UNSTARTED task (a handle). Nothing runs yet.
gather [t1, t2, ...]    ->  runs every task on its own OS thread, in parallel,
                            blocks until all finish, returns their results IN ORDER.
```

```nx
agent slow(n) { seed s = 0
  for each i in range(n) { s = s + (i % 7) }
  report s
}

emit gather [dispatch slow(8000000), dispatch slow(8000000), dispatch slow(8000000)]
```

`gather` is an ordinary expression — its result is a list, so it composes with everything: `gather tasks | sum`,
`seed [a, b] = gather [...]`, `match gather [...] { ... }`.

## Why this shape (and not threads-with-shared-memory)

Nx's law is *"agents do not merge."* Shared mutable state across threads is exactly merging — and the bug
factory (data races) that comes with it. So a dispatched task runs in **its own fresh interpreter**: it sees

- the **standard library**,
- **its own arguments**, and
- **itself** (so recursion works),

and **nothing else** — not the parent's pathways, not other user agents, not captured closure state. A task
that reaches for a parent pathway fails *cleanly* (`unknown pathway 'x'`) rather than silently reading a stale
copy. Isolation by construction means there is no shared state to race on. That is the whole trick.

The cost of isolation is the **data boundary**: arguments and results cross threads *by value*, so they must be
plain data — `number`, `string`, `bool`, `list`, `mesh`, `void`. Passing or returning an **agent** (code closes
over an environment that cannot follow it across the boundary) is rejected loudly at the boundary, never shipped
as a meaningless blob.

## How it works (the mechanism is ours)

The interpreter is a synchronous tree-walker, and we keep it that way. `gather` gets parallelism without going
async by reusing the zero-dependency **worker + `Atomics` + `SharedArrayBuffer`** pattern already proven in
`nx-live`:

1. `gather` spawns one `Worker` (`nx-par-worker.js`) per task, handing each the agent's AST (`params` + `body`)
   and its args as JSON, plus one shared `Int32Array` barrier counter and a private `MessageChannel`.
2. Each worker builds a fresh interpreter, defines the agent under its own name (recursion), runs it, then in a
   `finally` — on *every* path, success or error — posts its result (or its error) and `Atomics.add`s the
   barrier counter and notifies. Posting before ticking means a visible tick guarantees the message is queued.
3. The calling thread blocks on `Atomics.wait` until the counter reaches N (Node permits `Atomics.wait` on the
   main thread; browsers do not). It then drains each channel with `receiveMessageOnPort` and returns the
   results in input order. Workers and ports are always reclaimed in a `finally`, even on throw or timeout.

**Error handling, precisely.** A task that `fail`s, throws, hits a runtime error (e.g. reaches for a parent
pathway), or fails to even load its interpreter surfaces *promptly* as a single `gather: <message>` error —
because the worker runs its barrier-tick from a `finally`, so any worker that executes *any* JS reports back.
The first error wins; the whole `gather` fails (all-or-nothing, like `Promise.all`). The one case the worker
*can't* self-report is a true hard death (OOM, `SIGKILL`) where the `finally` never runs — that is caught by
the wall-clock timeout (default 30s), which terminates the stragglers and throws a `timed out` error. (We do
*not* rely on a parent-side `error`/`exit` callback to release the barrier: the event loop is frozen during
`Atomics.wait`, so those callbacks can't fire mid-gather — they exist only so a worker failure can't crash the
parent process.)

## What is honest about the performance

Measured on the dev laptop (i7-8750H, 6 physical / 12 logical cores, ~2GB free RAM):

- **The interpreter runs at native speed inside a worker.** Pure compute, startup excluded: main 4.70s vs
  worker 4.65s for the same loop. There is *no* per-worker interpreter penalty.
- **Parallelism is real.** Two CPU-bound tasks complete in ~1.05x the time of one (18.5s vs 17.4s) — two tasks
  for the price of one.
- **Speedup is bounded by the machine, not the language.** 4 tasks do **not** hit 4x on this box, because of
  (a) only 6 physical cores, (b) ~2GB free RAM (large allocations like `range(8_000_000)` thrash), and
  (c) aggressive thermal throttling under sustained all-core load. On a cooler, higher-core machine the curve
  keeps climbing.
- **Worker startup is ~0.2s** (a fresh interpreter + stdlib parse) and overlaps across workers. Parallelize
  *expensive* work; for trivial work the startup dominates.

## Limits (v1, on purpose)

- **One worker per task per gather** (no pool yet). Fine for coarse-grained work; a pool is a future optimization.
- **Tasks are isolated** — no shared state, no inter-task channels. Coordination is by *structure* (dispatch →
  gather), not by message-passing between running tasks.
- **Self-contained agents only.** Calling *other* user agents from inside a dispatched agent fails (they are not
  defined in the worker). Inline what the task needs, or pass it as data.
- **Not cooperative concurrency.** There is no `yield`/await; this is OS-thread parallelism with a blocking
  barrier. A cooperative scheduler is a separate, later layer (and the road toward the Physarum scheduler).

---

# The Physarum scheduler — `schedule` / `flows`

> Where `gather` runs a fixed list of tasks, `schedule` runs a **batch through a learning pool**. It is `route`
> (the slime-mold *selector*) lifted to parallel batches: the same reinforce/decay law that governs memory now
> governs **execution** — fast workers pull more flux, slow/failed ones decay and get routed around. The
> language *becomes* the scheduler.

```nx
agent worker(chunk) {           # a worker takes a CHUNK (a list) and returns a results list, same length, in order
  seed out = []
  for each x in chunk { out = out + [x * x] }
  report out
}

emit schedule("squares", [worker, worker], [1, 2, 3, 4, 5, 6, 7, 8])   # -> [1, 4, 9, 16, 25, 36, 49, 64]
emit flows("squares")                                                   # the learned conductance of each tube
```

## What it does

`schedule(name, workers, items)`:
1. Looks up (or creates) a **named, persistent pool** of interchangeable worker-agents — `name` keys the learned
   state, exactly like `route`. Reusing a name with different workers is rejected (no silent stale pool).
2. **Distributes** the items across the workers proportional to conductance, via the same credit + explore-floor
   weighted round-robin as `route`. The credit array is **persisted on the pool** across calls, so a trailing or
   recovered worker is sampled at a rate ∝ its conductance over successive batches (not starved by small batches).
3. Runs each worker's chunk on its **own worker thread, in parallel** (`gather`'s settled runner underneath),
   blocks, and reassembles every result at its **original item index**.
4. Updates each worker's conductance from its **measured per-item speed** (the worker reports its own compute
   time): `quality = 1 + 8/(ms_per_item + 1)`, `cond ← EWMA(cond, quality)`. Fast workers climb; a worker that
   errors decays toward the floor.

`flows(name)` returns the pool's learned conductances (it also reports `route` conductances — one viewer for both).

## Failover

If a worker errors, its conductance decays hard and **its items reroute to the survivors** in one more parallel
round — the slime mold routing around a damaged tube. If every worker fails (or a survivor also fails during the
reroute), `schedule` throws rather than returning partial/silent results. Failover is **single-tier on purpose**:
one reroute round, then surface the error. (A multi-tier cascade is a future option; one tier covers the common
"some tubes are dead" case without unbounded retry.)

## What is honest about it

- **Adaptation needs more than one call.** The first batch explores (uniform-ish); conductances diverge as speed
  is measured, so *later* batches exploit. Measured: a fast/slow pool over 4 rounds converged to roughly
  `{fast: 7, slow: 1}` — the next batch then routes ~7× the flux to the fast tube. Same explore-then-exploit
  honesty as `route`; the constants are hand-tuned and exploit-leaning.
- **Timing is nondeterministic**, so exact conductances vary run to run. The guarantees that *don't* vary:
  every item is processed exactly once, results are in item order, and a clearly-faster worker ends higher.
- **Worker contract:** batch in, batch out (`worker(chunk) -> results`, one result per item, in order). This
  spawns *N* threads (one per worker), not one per item — efficient for real batches. A wrong-length or non-list
  return is a loud contract error. The `dispatch` data boundary applies: items and results must be plain data.
- **No shared state between workers** (same isolation as `gather`) — which is exactly why distributing work
  across them is race-free.

---

# Cooperative concurrency — fibers + channels (`spawn` / `give` / `take` / `yield` / `await`)

> Where `gather`/`schedule` give **parallelism** (many OS threads, isolated tasks), fibers give the other half:
> **concurrency** — many tasks interleaving on *one* thread, talking through **channels**. It's the
> law-consistent way to do *communicating* tasks: no shared memory, the value passes hand to hand.

```nx
seed ch = channel()                              # an unbounded channel; channel(n) is bounded (backpressure)

agent producer(c) { seed i = 0
  reinforce i < 3 { give i to c                   # `give VALUE to CHANNEL` — blocks only if a bounded channel is full
    i = i + 1 } }

agent consumer(c) { seed k = 0
  reinforce k < 3 { take x from c                 # `take NAME from CHANNEL` — parks the fiber until a value arrives
    emit x
    k = k + 1 } }

spawn producer(ch)                                # start a fiber (cooperative, NOT a thread)
spawn consumer(ch)                                # both run, interleaved, at program end -> 0 1 2
```

## The model

- `spawn f(args)` — start a **fiber** and return a handle. Fibers run **cooperatively** on the calling thread:
  one runs until it parks on a channel (or `yield`s), then the scheduler runs the next ready fiber. This is
  *concurrency, not parallelism* — for real multi-core work use `gather`/`schedule`.
- `give VALUE to CHANNEL` / `take NAME from CHANNEL` — send / receive. A `take` on an empty channel parks the
  fiber until a value is given; a `give` to a *full bounded* channel parks until space frees. Delivery is
  **exactly-once, FIFO**.
- `yield` — voluntarily give up the turn (cooperative round-robin).
- `await(fiber)` — run the scheduler and return that fiber's reported value (or re-raise its error). `drain()` —
  run **all** fibers to completion. Spawned-but-unawaited fibers also run at program end; a failed fiber's error
  **never vanishes** — it surfaces at `await`/`drain`/program end.
- `channel()` unbounded; `channel(n)` bounded to `n` (backpressure). Channels are not data — they can't cross the
  `gather`/`dispatch` thread boundary (rejected loudly).

## Why it's race-free

A channel is the *only* thing shared, and a value moves through it hand to hand — there is no shared mutable
state for two fibers to clobber. The scheduler is single-threaded and **deterministic**, so a fiber program's
output is reproducible (unlike the timing-dependent parallel side).

## Honest scope (v1)

- **Cooperative, not parallel** — fibers interleave on one thread. (Compose with `gather` when you need cores.)
- **Suspension composes through** the fiber's own body and inside `when` / `match` / `for each` / `reinforce` /
  `attempt`. It does **not** cross into a *called* agent's body (a helper a fiber calls can't `give`/`take`) — that
  would need the whole call stack to be suspendable. Doing so is a **clear, honest error**, not a silent failure.
- `await`/`drain` can't be called from *inside* a fiber (that would re-enter the scheduler) — coordinate with
  channels or `yield` instead; a clean error says so.
- A runaway fiber (e.g. `yield` forever) is bounded by a step budget and **errors**, never hangs.
- No `select`/timeouts/closeable channels yet; deadlocks (everyone parked) are detected and reported.
