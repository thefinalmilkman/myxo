'use strict';
// myxo-concurrent.js — the parent half of Myxo parallelism. Spawns one worker per task, runs them on real OS
// threads, and blocks the calling thread on an Atomics barrier until all finish — so the synchronous `gather`
// gets genuine multi-core parallelism with no callbacks. Built on the same worker+Atomics pattern as myxo-live.
//
// runParallel(tasks, opts) -> [results] (plain JS values), in input order.
//   tasks[i] = { name, params, body, args }   args are plain JS (already myxo->js converted)
//   throws on the first task error, or on a wall-clock timeout (workers are always terminated).

const { Worker, MessageChannel, receiveMessageOnPort } = require('worker_threads');
const path = require('path');

// Native delivery can lag a hair behind the Atomics tick, so the drain spins briefly. This is a backstop,
// not the mechanism: a worker posts its message BEFORE ticking the barrier (see myxo-par-worker.js), so once
// the barrier is satisfied the message is already queued. The spin only covers nanosecond delivery latency.
const DRAIN_SPINS = 5000000;

// A value that crosses the thread boundary must be plain DATA. Code (agents/natives) closes over an
// environment that cannot follow it into an isolated worker, so we reject it loudly at the boundary
// instead of silently shipping a meaningless AST blob. VOID arrives as a symbol — that is fine (-> null).
function assertSerializable(v, label, seen) {
  if (v === null || v === undefined) return;
  const t = typeof v;
  if (t === 'number') {
    // JSON renders NaN/Infinity as "null", so they would arrive as void — a silent wrong answer. Reject
    // them at the boundary, exactly as polyglot.js does for the language bridge: never a silent null.
    if (!Number.isFinite(v)) throw new Error(`${label} cannot be a non-finite number (NaN or Infinity)`);
    return;
  }
  if (t === 'string' || t === 'boolean' || t === 'symbol') return;   // symbol = VOID, fine (-> null)
  if (t === 'function') throw new Error(`${label} cannot be a function`);
  if (v.__agent || v.__native || v.__task) {
    throw new Error(`${label} must be data (number, string, bool, list, mesh) — not an agent or task`);
  }
  seen = seen || new Set();
  if (seen.has(v)) throw new Error(`${label} cannot be cyclic`);
  seen.add(v);
  if (Array.isArray(v)) { for (const x of v) assertSerializable(x, label, seen); seen.delete(v); return; }
  if (v instanceof Map) {                                            // validate keys too (future-proof; today keys are strings)
    for (const [k, x] of v) { assertSerializable(k, label, seen); assertSerializable(x, label, seen); }
    seen.delete(v); return;
  }
  throw new Error(`${label} must be data (number, string, bool, list, mesh)`);
}

// The settled core: run every task on its own worker thread, block on the Atomics barrier, and return ONE
// outcome per task IN ORDER — `{ ok:true, value, ms }` or `{ ok:false, error }`. It never throws on a task
// failure (the caller decides policy: gather fails fast, the scheduler reroutes); it throws only on the
// wall-clock timeout. `ms` is the worker's self-measured compute time — the scheduler's conductance signal.
function runSettled(tasks, opts = {}) {
  const n = tasks.length;
  if (n === 0) return [];
  const timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : 30000;
  const now = opts.now || (() => Date.now());

  const counter = new Int32Array(new SharedArrayBuffer(4));    // workers tick this; we wait on it
  const workers = [];
  const ports = [];
  const cleanup = () => { for (const w of workers) w.terminate(); for (const p of ports) p.close(); };

  try {
    for (let i = 0; i < n; i++) {
      const { port1, port2 } = new MessageChannel();
      const t = tasks[i];
      const w = new Worker(path.join(__dirname, 'myxo-par-worker.js'), {
        workerData: { name: t.name, params: t.params, body: t.body, argsJSON: JSON.stringify(t.args), counterSab: counter.buffer, port: port2 },
        transferList: [port2],
      });
      // These listeners exist ONLY so a worker failure can't crash the parent PROCESS — they cannot release
      // the barrier, because the event loop is frozen while we sit in Atomics.wait below. A worker that runs
      // any JS at all ticks the barrier itself from a `finally` (myxo-par-worker.js); a true hard death (OOM,
      // SIGKILL) that never runs that `finally` is caught by the wall-clock timeout. No callback is relied on.
      w.on('error', () => {});
      w.on('exit', () => {});
      workers.push(w);
      ports.push(port1);
    }

    const deadline = now() + timeoutMs;                        // barrier: block until every worker has ticked
    while (Atomics.load(counter, 0) < n) {
      const c = Atomics.load(counter, 0);                      // re-read each pass so an increment racing the wait can't be lost
      const remaining = deadline - now();
      if (remaining <= 0) throw new Error(`gather timed out after ${timeoutMs}ms (a worker never responded — possible hard crash or OOM)`);
      Atomics.wait(counter, 0, c, Math.min(remaining, 1000));
    }

    const outcomes = new Array(n);
    for (let i = 0; i < n; i++) {
      let m = receiveMessageOnPort(ports[i]);
      let spins = 0;
      while (!m && spins < DRAIN_SPINS) { m = receiveMessageOnPort(ports[i]); spins++; }
      if (!m) { outcomes[i] = { ok: false, error: `no result from worker ${i}` }; continue; }
      const r = m.message;
      outcomes[i] = r.ok ? { ok: true, value: JSON.parse(r.resultJSON), ms: r.ms } : { ok: false, error: r.error };
    }
    return outcomes;
  } finally {
    cleanup();                                                // always reclaim threads + ports — even on throw/timeout
  }
}

// gather's runner: first error wins (all-or-nothing, like Promise.all); returns plain values in order.
function runParallel(tasks, opts = {}) {
  const outcomes = runSettled(tasks, opts);
  const bad = outcomes.find(o => o && !o.ok);
  if (bad) throw new Error(bad.error);
  return outcomes.map(o => o.value);
}

module.exports = { runParallel, runSettled, assertSerializable };
