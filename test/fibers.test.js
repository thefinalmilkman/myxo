'use strict';
// fibers.test.js — cooperative concurrency: spawn / channels (give..to / take..from) / yield / await / drain.
// The scheduler is single-threaded and deterministic, so unlike the parallel tests these assert EXACT output.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../myxo');
const out = (src) => run(src, { capture: true });

const PROD = 'agent producer(c) { seed i = 0\n reinforce i < 3 { give i to c\n i = i + 1 } }\n';
const CONS = 'agent consumer(c) { seed k = 0\n reinforce k < 3 { take x from c\n emit x\n k = k + 1 } }\n';

// ---- the basics ----
test('producer/consumer over a channel, in order', () => {
  assert.equal(out(`seed ch = channel()\n${PROD}${CONS}spawn producer(ch)\nspawn consumer(ch)`), '0\n1\n2\n');
});
test('a bounded channel applies backpressure and still delivers in order', () => {
  const src = `seed ch = channel(1)
agent prod(c) { seed i = 10
  reinforce i < 14 { give i to c
    i = i + 1 } }
agent cons(c) { seed k = 0
  reinforce k < 4 { take x from c
    emit x
    k = k + 1 } }
spawn prod(ch)
spawn cons(ch)`;
  assert.equal(out(src), '10\n11\n12\n13\n');
});
test('await(spawn f(..)) runs the scheduler and returns the fiber\'s reported value', () => {
  assert.equal(out('agent worker(n) { report n * n }\nemit await(spawn worker(8))'), '64\n');
});
test('drain() runs spawned fibers to completion', () => {
  assert.equal(out(`seed ch = channel()\n${PROD}${CONS}spawn producer(ch)\nspawn consumer(ch)\ndrain()\nemit "done"`), '0\n1\n2\ndone\n');
});

// ---- composition: pipeline, fan-in, interleaving ----
test('a three-stage pipeline (source -> transform -> sink) threads values through channels', () => {
  const src = `seed a = channel()
seed b = channel()
agent source(o) { seed i = 1
  reinforce i < 4 { give i to o
    i = i + 1 } }
agent mid(inp, o) { seed k = 0
  reinforce k < 3 { take x from inp
    give x * 10 to o
    k = k + 1 } }
agent sink(inp) { seed k = 0
  reinforce k < 3 { take y from inp
    emit y
    k = k + 1 } }
spawn source(a)
spawn mid(a, b)
spawn sink(b)`;
  assert.equal(out(src), '10\n20\n30\n');
});
test('yield interleaves fibers cooperatively (round-robin)', () => {
  const src = `agent tick(label) { seed n = 0
  reinforce n < 2 { emit label
    n = n + 1
    yield } }
spawn tick("A")
spawn tick("B")`;
  assert.equal(out(src), 'A\nB\nA\nB\n');
});
test('fan-in: two feeders into one worker, await the aggregate', () => {
  const src = `seed ch = channel()
agent worker(inp) { seed total = 0
  seed k = 0
  reinforce k < 4 { take v from inp
    total = total + v
    k = k + 1 }
  report total }
agent feed(c, base) { seed j = 0
  reinforce j < 2 { give base + j to c
    j = j + 1 } }
seed w = spawn worker(ch)
spawn feed(ch, 10)
spawn feed(ch, 20)
emit await(w)`;
  assert.equal(out(src), '62\n');   // 10+11+20+21
});
test('a channel op nested inside for-each (control flow) still suspends correctly', () => {
  const src = `seed ch = channel()
agent send_all(c, xs) { for each v in xs { give v to c } }
agent take_all(c) { seed k = 0
  reinforce k < 3 { take x from c
    emit x
    k = k + 1 } }
spawn send_all(ch, [7, 8, 9])
spawn take_all(ch)`;
  assert.equal(out(src), '7\n8\n9\n');
});

// ---- safety & errors ----
test('a deadlock (drawing with no one to flow) is detected, not a silent hang', () => {
  assert.throws(() => out('seed ch = channel()\nagent stuck(c) { take x from c }\nspawn stuck(ch)'),
    (e) => /deadlock/.test(e.message));
});
test('an error inside a fiber surfaces through await', () => {
  assert.throws(() => out('agent boom() { fail "fiber broke" }\nemit await(spawn boom())'),
    (e) => /fiber broke/.test(e.message));
});
test('give/take/yield outside a spawned fiber are a clean error, never silent', () => {
  assert.throws(() => out('seed ch = channel()\ntake x from ch'), (e) => /only valid inside a spawned fiber/.test(e.message));
  assert.throws(() => out('seed ch = channel()\ngive 1 to ch'), (e) => /only valid inside a spawned fiber/.test(e.message));
  assert.throws(() => out('yield'), (e) => /only valid inside a spawned fiber/.test(e.message));
});

// ---- the gate's findings: suspension composes through match/attempt; await/drain re-entrancy is a clean error ----
test('a channel op inside an attempt block suspends — it is NOT swallowed as a fake failure (no silent loss)', () => {
  // Finding 1: previously `give` inside attempt threw the sync guard, rescue caught it, and the value vanished.
  const src = `seed ch = channel()
agent producer(c) { attempt { give 42 to c } rescue e { emit "SWALLOWED" } }
agent consumer(c) { take x from c
  emit x }
spawn producer(ch)
spawn consumer(ch)`;
  assert.equal(out(src), '42\n');   // delivered, not swallowed
});
test('a channel op inside a match arm suspends correctly', () => {
  const src = `seed ch = channel()
agent producer(c, kind) { match kind { "go" { give 7 to c } _ { give 0 to c } } }
agent consumer(c) { take x from c
  emit x }
spawn producer(ch, "go")
spawn consumer(ch)`;
  assert.equal(out(src), '7\n');
});
test('await/drain called from INSIDE a fiber is a clean error, not a false deadlock', () => {
  // Finding 3: a fiber awaiting a child re-entered the scheduler and reported a deadlock that never happened.
  assert.throws(() => out('agent child(n) { report n }\nagent parent() { seed c = spawn child(5)\n seed r = await(c)\n report r }\nemit await(spawn parent())'),
    (e) => /already running|inside a fiber/.test(e.message));
});
test('a channel op inside a CALLED agent gives an honest error (names the real limitation)', () => {
  // Finding 2: the message used to claim "not in a fiber" when you clearly were.
  assert.throws(() => out('seed ch = channel()\nagent sendit(c) { give 1 to c }\nagent worker(c) { sendit(c) }\nspawn worker(ch)'),
    (e) => /inside a called agent/.test(e.message));
});
test('a background fiber\'s failure never vanishes — surfaces even when only an unrelated fiber is awaited', () => {
  // Re-gate finding: await(g) marked the failing bad() done, and the program-end guard skipped done fibers -> silent loss.
  assert.throws(() => out('agent good() { report 1 }\nagent bad() { fail "boom" }\nseed g = spawn good()\nspawn bad()\nemit await(g)'),
    (e) => /boom/.test(e.message));
});
test('a spawned fiber still runs (and its error surfaces) even when the program ends via a top-level report', () => {
  assert.throws(() => out('agent bad() { fail "no-vanish" }\nspawn bad()\nreport 0'), (e) => /no-vanish/.test(e.message));
});
test('spawn needs an agent; await needs a fiber', () => {
  assert.throws(() => out('seed x = 5\nspawn x(1)'), (e) => /spawn needs an agent/.test(e.message));
  assert.throws(() => out('emit await(5)'), (e) => /await needs a fiber/.test(e.message));
});
test('channel capacity must be a positive whole number', () => {
  assert.throws(() => out('seed ch = channel(0)'), (e) => /positive whole number/.test(e.message));
  assert.throws(() => out('seed ch = channel("x")'), (e) => /expected a number/.test(e.message));
});
test('a channel cannot cross the thread boundary into a dispatched task (it is not data)', () => {
  assert.throws(() => out('agent w(c) { report 1 }\nseed ch = channel()\nemit gather [dispatch w(ch)]'),
    (e) => /must be data/.test(e.message));
});
test('a fiber can call ordinary agents synchronously', () => {
  const src = `seed ch = channel()
agent twice(n) { report n * 2 }
agent worker(c) { take x from c
  emit twice(x) }
spawn worker(ch)
agent feeder(c) { give 21 to c }
spawn feeder(ch)`;
  assert.equal(out(src), '42\n');
});
test('the connectors `to` and `from` are contextual, not reserved — still valid variable names', () => {
  assert.equal(out('seed to = 3\nseed from = 4\nemit to + from'), '7\n');
});
