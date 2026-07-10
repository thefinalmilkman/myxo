'use strict';
// pipe.test.js — pipelines (`x | f`) and destructuring (`seed [a, ...t] = xs` / `seed { a, b } = m`).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../myxo');
const { formatSource } = require('../format');
const out = (src) => run(src, { capture: true });

// ---- pipelines ----
test('pipe: x | f calls f(x)', () => {
  assert.equal(out('emit ("hello" | upper)'), 'HELLO\n');
  assert.equal(out('agent double(x){ report x*2 }\nemit (5 | double)'), '10\n');
});
test('pipe chains left-to-right', () => {
  assert.equal(out('agent double(x){ report x*2 }\nemit (5 | double | double)'), '20\n');
});
test('pipe: x | f(a) makes x the FIRST arg -> f(x, a) (order matters)', () => {
  assert.equal(out('agent add(a,b){ report a+b }\nemit (3 | add(4))'), '7\n');
  assert.equal(out('agent sub(a,b){ report a-b }\nemit (10 | sub(3))'), '7\n');   // sub(10,3), not sub(3,10)
});
test('pipe binds looser than arithmetic: `a + 1 | f` is f(a+1)', () => {
  assert.equal(out('agent double(x){ report x*2 }\nemit (2 + 1 | double)'), '6\n');
});
test('pipe evaluates the piped value exactly once', () => {
  assert.equal(out('seed c = [0]\nagent bump(){ c[0] = c[0] + 1\n report c[0] }\nagent id(x){ report x }\nemit (bump() | id)\nemit c[0]'), '1\n1\n');
});
test('a piped call still passes the capability fence', () => {
  assert.throws(() => run('needs other\nemit (5 | secret)', { capture: true, natives: { secret: (a) => a[0] } }),
    (e) => /not declared/.test(e.message));
});

// ---- destructuring ----
test('destructure a list', () => {
  assert.equal(out('seed [a, b] = [1, 2]\nemit a, b'), '1 2\n');
});
test('destructure with ...rest (can be empty)', () => {
  assert.equal(out('seed [head, ...tail] = [1, 2, 3]\nemit head, tail'), '1 [2, 3]\n');
  assert.equal(out('seed [only, ...rest] = [9]\nemit only, rest'), '9 []\n');
});
test('destructure a mesh — shorthand { a } and explicit { "k": v }', () => {
  assert.equal(out('seed { x, y } = { "x": 10, "y": 20 }\nemit x, y'), '10 20\n');
  assert.equal(out('seed { "k": v } = { "k": 9 }\nemit v'), '9\n');
});
test('destructuring nests', () => {
  assert.equal(out('seed [a, [b, c]] = [1, [2, 3]]\nemit a, b, c'), '1 2 3\n');
});
test('a destructure that does not match the shape is an error', () => {
  assert.throws(() => out('seed [a, b] = [1]'), (e) => /did not match/.test(e.message));
  assert.throws(() => out('seed { x } = 5'), (e) => /did not match/.test(e.message));
});
test('duplicate names in a destructure are rejected (linear)', () => {
  assert.throws(() => out('seed [a, a] = [1, 2]'), (e) => /more than once/.test(e.message));
});
test('a mesh-pattern name followed by a colon errors helpfully', () => {
  assert.throws(() => out('seed { a: b } = m'), (e) => /keys are strings/.test(e.message));
});

// ---- formatting ----
test('the formatter round-trips pipelines + destructuring (idempotent)', () => {
  const src = 'seed [head, ...tail] = xs\nseed { a, b } = m\nemit data | lower | sort\n';
  const f = formatSource(src);
  assert.equal(formatSource(f), f);
  assert.match(f, /\| lower \| sort/);
  assert.match(f, /seed \{ a, b \} = m/);
});
