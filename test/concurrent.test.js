'use strict';
// concurrent.test.js — `dispatch` / `gather`: real worker-thread parallelism.
// These assertions are DETERMINISTIC (correctness, isolation, error propagation, the data boundary).
// The parallelism *speedup* is environment-sensitive (cores, RAM, thermal) so it is checked only as a
// loose, machine-gated sanity bound at the end — never as a tight timing assertion that could flake.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const { run } = require('../myxo');
const { runParallel } = require('../myxo-concurrent');
const { parse } = require('../parser');
const out = (src) => run(src, { capture: true });

// ---- correctness ----
test('gather returns results in dispatch order', () => {
  assert.equal(out('agent sq(n){ report n*n }\nemit gather [dispatch sq(2), dispatch sq(3), dispatch sq(4), dispatch sq(5)]'),
    '[4, 9, 16, 25]\n');
});
test('a single dispatched task gathers to a one-element list', () => {
  assert.equal(out('agent sq(n){ report n*n }\nemit gather [dispatch sq(7)]'), '[49]\n');
});
test('gather of an empty list is an empty list (no workers spawned)', () => {
  assert.equal(out('emit gather []'), '[]\n');
});
test('a dispatched agent may recurse (it is defined under its own name in the worker)', () => {
  assert.equal(out('agent fib(n){ when n < 2 { report n }\n report fib(n-1) + fib(n-2) }\nemit gather [dispatch fib(10), dispatch fib(11)]'),
    '[55, 89]\n');
});
test('a dispatched agent runs its own loops/locals correctly', () => {
  assert.equal(out('agent tri(n){ seed t = 0\n for each i in range(n+1) { t = t + i }\n report t }\nemit gather [dispatch tri(4), dispatch tri(5)]'),
    '[10, 15]\n');
});

// ---- the data boundary (values cross threads by value) ----
test('list args and results round-trip across the boundary', () => {
  assert.equal(out('agent sum(xs){ seed t = 0\n for each v in xs { t = t + v }\n report t }\nemit gather [dispatch sum([1, 2, 3, 4])]'),
    '[10]\n');
});
test('mesh args round-trip across the boundary', () => {
  assert.equal(out('agent pick(m){ report m["x"] }\nemit gather [dispatch pick({ "x": 42 })]'), '[42]\n');
});
test('void survives the boundary', () => {
  assert.equal(out('agent isv(x){ when x == void { report 1 }\n report 0 }\nemit gather [dispatch isv(void), dispatch isv(5)]'),
    '[1, 0]\n');
});

// ---- isolation: a task sees only stdlib + its args + itself ----
test('a dispatched agent cannot read the parent\'s pathways (race-free by construction)', () => {
  assert.throws(() => out('seed secret = 99\nagent peek(n){ report secret + n }\nemit gather [dispatch peek(1)]'),
    (e) => /unknown pathway 'secret'/.test(e.message));
});

// ---- error propagation ----
test('a task failure surfaces through gather', () => {
  assert.throws(() => out('agent boom(n){ when n > 0 { fail "task exploded" }\n report n }\nemit gather [dispatch boom(1)]'),
    (e) => /task exploded/.test(e.message));
});

// ---- the data-only contract is enforced at both ends ----
test('dispatch rejects a non-data argument (an agent)', () => {
  assert.throws(() => out('agent id(x){ report x }\nagent other(y){ report y }\nemit gather [dispatch id(other)]'),
    (e) => /must be data/.test(e.message));
});
test('gather rejects a task that returns code (a non-data result)', () => {
  assert.throws(() => out('agent mk(){ report agent(x){ report x } }\nemit gather [dispatch mk()]'),
    (e) => /must be data/.test(e.message));
});
test('a non-finite number is rejected as an arg, never silently nulled', () => {
  assert.throws(() => out('agent id(x){ report x }\nemit gather [dispatch id(pow(10, 1000))]'),
    (e) => /non-finite/.test(e.message));
});
test('a non-finite result is rejected, never silently nulled', () => {
  assert.throws(() => out('agent inf(){ report pow(10, 1000) }\nemit gather [dispatch inf()]'),
    (e) => /non-finite/.test(e.message));
  assert.throws(() => out('agent nan(){ report sqrt(0 - 1) }\nemit gather [dispatch nan()]'),
    (e) => /non-finite/.test(e.message));
});

// ---- shape errors ----
test('dispatch needs an agent value', () => {
  assert.throws(() => out('seed x = 5\nemit gather [dispatch x(1)]'), (e) => /needs an agent/.test(e.message));
});
test('dispatch needs a call form (parse error otherwise)', () => {
  assert.throws(() => out('emit dispatch 5'), (e) => /dispatch needs an agent call/.test(e.message));
});
test('gather needs a list', () => {
  assert.throws(() => out('emit gather 5'), (e) => /list of dispatched tasks/.test(e.message));
});
test('gather needs dispatched tasks, not arbitrary values', () => {
  assert.throws(() => out('emit gather [1, 2]'), (e) => /not a dispatched task/.test(e.message));
});

// ---- the wall-clock backstop (deterministic; direct runParallel so we can inject a tiny timeout) ----
test('the timeout fires promptly and reclaims a never-finishing worker (no hang)', () => {
  const a = parse('agent busy(n){ seed i = 0\n reinforce i < n { i = i + 1 }\n report i }').body[0];
  const task = { name: a.name, params: a.params, body: a.body, args: [100000000] };   // far more work than the timeout allows
  const t = process.hrtime.bigint();
  assert.throws(() => runParallel([task], { timeoutMs: 50 }), (e) => /timed out/.test(e.message));
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  assert.ok(ms < 5000, `timeout must fire promptly, took ${Math.round(ms)}ms`);   // not the 30s default
});

// ---- parallelism sanity (machine-gated, loose bound; informational, never tight) ----
test('two CPU-bound tasks overlap (loose bound; skipped on small machines)', { skip: os.cpus().length < 4 ? 'needs >= 4 cores' : false }, () => {
  const LOOP = 'agent busy(n){ seed s = 0\n seed i = 0\n reinforce i < n { s = s + (i % 7)\n i = i + 1 }\n report s }\n';
  const N = 4000000;
  const t1 = process.hrtime.bigint();
  out(`${LOOP}emit gather [dispatch busy(${N})]`);
  const single = Number(process.hrtime.bigint() - t1) / 1e6;
  const t2 = process.hrtime.bigint();
  out(`${LOOP}emit gather [dispatch busy(${N}), dispatch busy(${N})]`);
  const pair = Number(process.hrtime.bigint() - t2) / 1e6;
  // True parallelism: two tasks finish in well under the 2x a serial run would take. 1.9x is a huge margin
  // over the ~1.05x we measure in practice, so this proves overlap without flaking under load.
  assert.ok(pair < single * 1.9, `expected 2 tasks (${Math.round(pair)}ms) to overlap vs 1 (${Math.round(single)}ms)`);
});
