'use strict';
// myxo-par-worker.js — the worker half of Myxo parallelism. Receives ONE agent (its params + body AST) and its
// args, runs it in a fresh isolated interpreter, posts the JSON result back, and signals the shared barrier.
// Isolation is the point: a dispatched agent gets its own interpreter (builtins + stdlib), so there is no
// shared mutable state to race. It is therefore self-contained — it sees its params, the stdlib, and itself
// (recursion), but NOT other user agents or the parent's pathways.

const { workerData } = require('worker_threads');
if (!workerData) return;   // this file is only meaningful when launched as a Worker; running it standalone is a no-op

// Pull only what we need to release the barrier FIRST, so that even a failure while loading the interpreter
// modules (a bad require) still ticks the counter from the `finally` — the parent must never hang on us.
const { name, params, body, argsJSON, counterSab, port } = workerData;
const counter = new Int32Array(counterSab);

let msg;
try {
  const { makeInterpreter } = require('./myxo');
  const { jsToNx, nxToJs } = require('./polyglot');
  const { assertSerializable } = require('./myxo-concurrent');
  const { performance } = require('perf_hooks');
  const interp = makeInterpreter();
  const agent = { __agent: true, name: name || 'task', params, body, closure: interp.globals };
  interp.globals.define(name || 'task', agent, true);          // define under its own name so recursion resolves
  const args = JSON.parse(argsJSON).map(jsToNx);
  const t0 = performance.now();
  const result = interp.callValue(agent, args, 0);
  const ms = performance.now() - t0;                           // pure compute time (excludes worker startup) — the scheduler's speed signal
  assertSerializable(result, 'a gathered result');             // a task must return data, not code, to cross back
  msg = { ok: true, resultJSON: JSON.stringify(nxToJs(result)), ms };
} catch (e) {
  msg = { ok: false, error: e && e.message ? e.message : String(e) };
} finally {
  // ALWAYS post-then-tick, on every path: the parent drains the message only after the barrier is satisfied,
  // so posting before ticking guarantees the message is queued by the time a visible tick releases the wait.
  try { port.postMessage(msg || { ok: false, error: 'worker produced no result' }); } catch {}
  Atomics.add(counter, 0, 1);
  Atomics.notify(counter, 0);
}
