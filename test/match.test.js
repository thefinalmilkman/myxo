'use strict';
// match.test.js — pattern matching (`match SUBJECT { PATTERN { ... } }`).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../myxo');
const { formatSource } = require('../format');
const out = (src) => run(src, { capture: true });

test('literal + wildcard arms', () => {
  assert.equal(out('match 0 { 0 { emit "z" }  _ { emit "o" } }'), 'z\n');
  assert.equal(out('match 5 { 0 { emit "z" }  _ { emit "o" } }'), 'o\n');
});

test('string / bool / void / negative literals', () => {
  assert.equal(out('match "hi" { "hi" { emit "y" }  _ { emit "n" } }'), 'y\n');
  assert.equal(out('match dead { live { emit "t" }  dead { emit "f" } }'), 'f\n');
  assert.equal(out('match void { void { emit "v" }  _ { emit "n" } }'), 'v\n');
  assert.equal(out('match -3 { -3 { emit "neg" }  _ { emit "n" } }'), 'neg\n');
});

test('a binding captures the whole value', () => {
  assert.equal(out('match 42 { n { emit n } }'), '42\n');
});

test('list pattern: exact length, element match, binds', () => {
  assert.equal(out('match [1, 2] { [a, b] { emit a, b } }'), '1 2\n');
  assert.equal(out('match [1, 2, 3] { [a, b] { emit "two" }  _ { emit "other" } }'), 'other\n');  // length mismatch
});

test('list pattern: ...rest (can be empty)', () => {
  assert.equal(out('match [1, 2, 3] { [head, ...tail] { emit head, tail } }'), '1 [2, 3]\n');
  assert.equal(out('match [9] { [only, ...rest] { emit only, rest } }'), '9 []\n');
});

test('mesh pattern matches a subset and binds values', () => {
  assert.equal(out('match { "kind": "ping", "id": 7 } { { "kind": k } { emit k } }'), 'ping\n');
  assert.equal(out('match { "a": 1 } { { "b": x } { emit "has-b" }  _ { emit "no-b" } }'), 'no-b\n');  // missing key
});

test('nested patterns', () => {
  assert.equal(out('match ["move", [3, 4]] { ["move", [x, y]] { emit x, y } }'), '3 4\n');
});

test('a literal arm does not match a different type ("1" is not 1)', () => {
  assert.equal(out('match "1" { 1 { emit "num" }  _ { emit "str" } }'), 'str\n');
});

test('type mismatch: a list pattern vs a non-list value', () => {
  assert.equal(out('match 5 { [a] { emit "list" }  _ { emit "not" } }'), 'not\n');
});

test('no arm matches -> nothing runs (no catch-all)', () => {
  assert.equal(out('match 5 { 0 { emit "z" } }\nemit "after"'), 'after\n');
});

test('the FIRST matching arm wins (top-to-bottom)', () => {
  assert.equal(out('match 0 { _ { emit "wild" }  0 { emit "zero" } }'), 'wild\n');
});

test('duplicate binding names in one pattern are rejected (linear patterns)', () => {
  assert.throws(() => out('match [1, 2] { [x, x] { emit x } }'), (e) => /more than once/.test(e.message));
  assert.throws(() => out('match [1, 2] { [x, ...x] { emit x } }'), (e) => /more than once/.test(e.message));
  assert.throws(() => out('match { "a": 1, "b": 2 } { { "a": v, "b": v } { emit v } }'), (e) => /more than once/.test(e.message));
});

test('distinct binding names across nesting are fine', () => {
  assert.equal(out('match [1, [2, 3]] { [a, [b, c]] { emit a, b, c } }'), '1 2 3\n');
});

test('an empty-arm match formats without a stray blank line', () => {
  assert.equal(formatSource('match x {}\n'), 'match x {}\n');
});

test('the formatter round-trips match (idempotent)', () => {
  const src = 'match x {\n  ["a", y] {\n    emit y\n  }\n  _ {\n    emit "no"\n  }\n}\n';
  const f = formatSource(src);
  assert.equal(formatSource(f), f);
  assert.match(f, /match x \{/);
  assert.match(f, /\["a", y\] \{/);
});
