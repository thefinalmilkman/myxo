'use strict';
// scheduler.test.js — the Physarum scheduler: `schedule(name, workers, items)`.
// Distributes a batch across a learning pool of worker-agents, runs the chunks on real worker threads in
// parallel, and feeds measured throughput back into the conductance law. Correctness/ordering/guards/failover
// are deterministic; the *adaptation* invariant (a clearly-faster worker ends with higher conductance) is
// asserted as a direction, not a number, so it can't flake.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../nx');
const out = (src) => run(src, { capture: true });

const DBL = 'agent dbl(chunk) { seed o = []\n for each x in chunk { o = o + [x * 2] }\n report o }\n';

// ---- correctness & ordering ----
test('schedule runs a batch through one worker, in order', () => {
  assert.equal(out(`${DBL}emit schedule("c1", [dbl], [1, 2, 3, 4, 5])`), '[2, 4, 6, 8, 10]\n');
});
test('results reassemble in ITEM order across several parallel workers', () => {
  assert.equal(out(`${DBL}emit schedule("c2", [dbl, dbl, dbl], [1, 2, 3, 4, 5, 6, 7, 8])`),
    '[2, 4, 6, 8, 10, 12, 14, 16]\n');
});
test('an empty batch schedules to an empty list (no workers run)', () => {
  assert.equal(out(`${DBL}emit schedule("c3", [dbl], [])`), '[]\n');
});
test('mesh/list work items round-trip through the pool', () => {
  assert.equal(out('agent pick(chunk) { seed o = []\n for each m in chunk { o = o + [m["v"]] }\n report o }\nemit schedule("c4", [pick], [{ "v": 7 }, { "v": 9 }])'),
    '[7, 9]\n');
});

// ---- adaptation: the pool LEARNS its speed profile (the thesis) ----
test('a clearly-faster worker ends with higher conductance than a slow one', () => {
  const src = `
agent fast(chunk) { seed o = []
  for each x in chunk { o = o + [x] }
  report o
}
agent slow(chunk) { seed o = []
  for each x in chunk { seed j = 0
    reinforce j < 200000 { j = j + 1 }
    o = o + [x]
  }
  report o
}
reinforce 4 times { schedule("adapt", [fast, slow], [1, 2, 3, 4, 5, 6, 7, 8]) }
seed f = flows("adapt")
emit f["fast"] > f["slow"]`;
  assert.equal(out(src), 'live\n');   // fast tube's conductance climbed above the slow tube's
});
test('flows of an unknown pool is an empty mesh', () => {
  assert.equal(out('emit len(flows("nope"))'), '0\n');
});
test('no permanent starvation: with small batches every worker is still eventually sampled (credit persists across calls)', () => {
  // The gate's finding: without persisted credit, small batches (m=1) freeze non-leading workers forever.
  // With instant workers a sampled tube's conductance rises above its initial 1, so "all > 1" proves all ran.
  const src = `
agent a(chunk) { report chunk }
agent b(chunk) { report chunk }
agent c(chunk) { report chunk }
reinforce 9 times { schedule("starve", [a, b, c], [1]) }
seed ok = live
for each v in values(flows("starve")) { when v <= 1 { ok = dead } }
emit ok`;
  assert.equal(out(src), 'live\n');
});

// ---- failover: the slime mold routes around a damaged tube ----
test('a failing worker decays and its items reroute to a survivor', () => {
  const src = 'agent boom(chunk) { fail "dead tube" }\nagent ok(chunk) { seed o = []\n for each x in chunk { o = o + [x * 10] }\n report o }\nemit schedule("fo", [boom, ok], [1, 2, 3])';
  assert.equal(out(src), '[10, 20, 30]\n');
});
test('if every worker fails, schedule surfaces the error (no silent loss)', () => {
  assert.throws(() => out('agent boom(chunk) { fail "all dead" }\nemit schedule("fo2", [boom, boom], [1, 2, 3])'),
    (e) => /every worker failed|all dead/.test(e.message));
});

// ---- the data + contract guards ----
test('a non-data work item is rejected (code can\'t cross the boundary)', () => {
  assert.throws(() => out('agent dbl(chunk) { report chunk }\nagent other(c) { report c }\nemit schedule("g1", [dbl], [1, other, 3])'),
    (e) => /must be data/.test(e.message));
});
test('a worker returning the wrong number of results is a contract error', () => {
  assert.throws(() => out('agent bad(chunk) { report [1] }\nemit schedule("g2", [bad], [1, 2, 3])'),
    (e) => /one result per item/.test(e.message));
});
test('a worker returning a non-list is a contract error', () => {
  assert.throws(() => out('agent bad(chunk) { report 5 }\nemit schedule("g3", [bad], [1, 2, 3])'),
    (e) => /non-list/.test(e.message));
});
test('reusing a pool name with different workers is rejected (no silent stale pool)', () => {
  assert.throws(() => out('agent ok(chunk) { report chunk }\nschedule("g4", [ok, ok], [1])\nschedule("g4", [ok], [1])'),
    (e) => /already defined with different workers/.test(e.message));
});
test('workers must be agents', () => {
  assert.throws(() => out('emit schedule("g5", [5], [1, 2])'), (e) => /workers must all be agents/.test(e.message));
});
test('items must be a list', () => {
  assert.throws(() => out('agent ok(chunk) { report chunk }\nemit schedule("g6", [ok], 5)'),
    (e) => /list of work items/.test(e.message));
});
test('a scheduled batch is never memoized away (a pure agent that schedules stays live)', () => {
  // two identical schedule calls must both actually run (state mutates / threads spawn) — not be cached.
  const src = `${DBL}agent twice() { seed a = schedule("m1", [dbl], [1, 2])\n seed b = schedule("m1", [dbl], [3, 4])\n report a + b }\nemit twice()`;
  assert.equal(out(src), '[2, 4, 6, 8]\n');
});
