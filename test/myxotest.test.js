'use strict';
// myxotest.test.js — node:test coverage for the `myxo test` runner (the meta-layer).
// The runner itself is then dogfooded by tests/lang.test.myx (Myxo testing itself in Myxo).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { run, runTests } = require('../myxo');
const { formatSource } = require('../format');

const rt = (src) => runTests(src);

test('a passing test counts as passed', () => {
  const r = rt('test "ok" { expect 1 + 1 is 2 }');
  assert.equal(r.passed, 1);
  assert.equal(r.failed, 0);
});

test('a failing `is` is reported with expected/got', () => {
  const r = rt('test "bad" { expect 1 is 2 }');
  assert.equal(r.failed, 1);
  assert.match(r.results[0].error, /expected 2, got 1/);
});

test('is not — pass and fail', () => {
  assert.equal(rt('test "t" { expect 1 is not 2 }').failed, 0);
  assert.equal(rt('test "t" { expect 1 is not 1 }').failed, 1);
});

test('truthy matcher: live passes, dead/0/void fail', () => {
  assert.equal(rt('test "t" { expect "hi" }').failed, 0);
  assert.equal(rt('test "t" { expect dead }').failed, 1);
  assert.equal(rt('test "t" { expect 0 }').failed, 1);
});

test('to fail: a failing expr passes, a succeeding expr fails the assertion', () => {
  assert.equal(rt('agent boom() { fail "x" }\ntest "t" { expect boom() to fail }').failed, 0);
  assert.equal(rt('test "t" { expect 1 + 1 to fail }').failed, 1);
});

test('to fail with: matches a substring of the failure message', () => {
  assert.equal(rt('agent boom() { fail "kaboom" }\ntest "t" { expect boom() to fail with "boom" }').failed, 0);
  assert.equal(rt('agent boom() { fail "kaboom" }\ntest "t" { expect boom() to fail with "nope" }').failed, 1);
});

test('deep equality: lists + meshes (order-insensitive)', () => {
  assert.equal(rt('test "t" { expect [1, [2, 3]] is [1, [2, 3]] }').failed, 0);
  assert.equal(rt('test "t" { expect { "a": 1, "b": 2 } is { "b": 2, "a": 1 } }').failed, 0);
  assert.equal(rt('test "t" { expect [1, 2] is [1, 2, 3] }').failed, 1);
});

test('each test is isolated: a failing test does not stop the next', () => {
  const r = rt('test "a" { expect 1 is 2 }\ntest "b" { expect 1 is 1 }');
  assert.equal(r.results.length, 2);
  assert.equal(r.results[0].ok, false);
  assert.equal(r.results[1].ok, true);
});

test('a runtime error inside a test fails that test, not the whole run', () => {
  const r = rt('test "t" { expect missing_pathway is 1 }');
  assert.equal(r.failed, 1);
  assert.match(r.results[0].error, /errored: unknown pathway/);
});

test('`expect` outside a test block is an error', () => {
  assert.throws(() => rt('expect 1 is 1'), (e) => /only valid inside a test/.test(e.message));
});

test('test blocks are inert in a normal run (not via myxo test)', () => {
  // a failing expect inside a test must NOT throw or print when the file is run normally
  const out = run('test "t" { expect 1 is 2 }\nemit "ran"', { capture: true });
  assert.equal(out, 'ran\n');
});

test('the self-hosted Myxo suite (tests/lang.test.myx) passes', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tests', 'lang.test.myx'), 'utf8');
  const r = runTests(src, { dir: path.join(__dirname, '..', 'tests') });
  assert.equal(r.failed, 0, r.results.filter(x => !x.ok).map(x => `${x.name}: ${x.error}`).join('; '));
  assert.ok(r.passed >= 8);
});

// ---- gate regressions: no false greens ----

test('to fail accepts only INTENTIONAL failures; an incidental error makes the test ERROR (not pass)', () => {
  // explicit `fail` is intentional -> passes
  assert.equal(rt('agent boom() { fail "x" }\ntest "t" { expect boom() to fail }').failed, 0);
  // an unknown pathway is a BUG, not an intended failure -> the test errors, never a false green
  const r = rt('test "t" { expect nope_typo to fail }');
  assert.equal(r.failed, 1);
  assert.match(r.results[0].error, /errored: unknown pathway/);
});

test('a `report` inside a test body is a failure, not a silent green', () => {
  const r = rt('test "t" { when live { report }\n expect 1 is 2 }');
  assert.equal(r.failed, 1);
  assert.match(r.results[0].error, /report/);
});

test('a test that runs zero expectations is failed, not passed', () => {
  assert.match(rt('test "empty" { }').results[0].error, /no expectations/);
  assert.equal(rt('test "setup only" { seed x = 5 }').failed, 1);
});

test('a truthy expect on an uncalled agent/native is rejected (forgot the call)', () => {
  const r = rt('agent f() { report 1 }\ntest "t" { expect f }');
  assert.equal(r.failed, 1);
  assert.match(r.results[0].error, /forget to call/);
});

test('assertion messages are type-tagged: 1 vs "1" are distinguishable', () => {
  assert.match(rt('test "t" { expect 1 is "1" }').results[0].error, /expected "1", got 1/);
});

test('contextual is/to do not merge across a statement boundary after a bare expect', () => {
  // `to`/`is` used as ordinary variable names right after a truthy expect must parse cleanly
  assert.equal(rt('seed to = 1\ntest "t" { expect live\n to = 6\n expect to is 6 }').failed, 0);
  assert.equal(rt('seed is = 1\ntest "t" { expect live\n is = 6\n expect is is 6 }').failed, 0);
});

test('the formatter round-trips test/expect syntax (idempotent)', () => {
  const src = 'test "x" {\n  expect add(2, 3) is 5\n  expect boom() to fail with "k"\n  expect 1 is not 2\n  expect live\n}\n';
  const f = formatSource(src);
  assert.match(f, /test "x"/);
  assert.match(f, /expect add\(2, 3\) is 5/);
  assert.match(f, /to fail with "k"/);
  assert.equal(formatSource(f), f);
});
