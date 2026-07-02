'use strict';
// Regression tests for the eval HARNESS itself (Phase 1 instrument). Every case here is a defect the
// two-agent gate found and reproduced on 2026-07-01 — pinned so the instrument can never silently regress
// into false-PASS or false-FAIL. A false result from the instrument is its cardinal sin.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { score, stripTests, missingConstruct, codeMinusNoise, parseError, loadTasks } = require('../nx-evals/run-evals');
const { extractNx } = require('../nx-evals/generators/extract');

const tasks = loadTasks();
const task = name => { const t = tasks.find(t => t.name === name); assert.ok(t, 'seed task missing: ' + name); return t; };

// --- CRITICAL: fence-01 must be scored on the audit ledger, not just stdout -------------------------------
test('fence cheat (hardcoded emits, empty ledger) is REJECTED', () => {
  const cheat = [
    'emit "lead: Vallarta\'s"',
    'emit "spend ok: spent 3"',
    'emit "over-cap blocked"',
    'emit "undeclared blocked"',
  ].join('\n');
  const r = score(task('fence-01-budget'), cheat);
  assert.equal(r.pass, false, 'a solution that never touches the fence must not pass the fence task');
  assert.equal(r.errClass, 'fence');
});

test('fence-01 reference solution still PASSES (output + ledger)', () => {
  const r = score(task('fence-01-budget'), task('fence-01-budget').solution);
  assert.equal(r.pass, true, r.detail);
});

// --- HIGH: construct gate — a required keyword the solution skips is a FAIL --------------------------------
test('control-01 without `match` is REJECTED (missing-construct)', () => {
  const noMatch = 'agent describe(v) { when len(v) == 0 { report "empty" } report "other" }';
  const r = score(task('control-01-shape'), noMatch);
  assert.equal(r.pass, false);
  assert.equal(r.errClass, 'missing-construct');
});

test('concurrency-01 without `dispatch`/`gather` is REJECTED (sequential loop cheat)', () => {
  const seq = 'agent sq(n) { report n * n }\nagent squares(xs) { seed out = [] for each x in xs { out = out + [sq(x)] } report out }';
  const r = score(task('concurrency-01-parallel'), seq);
  assert.equal(r.pass, false);
  assert.equal(r.errClass, 'missing-construct');
});

// --- HIGH: a model's own test blocks must not fail a task whose official checks pass -----------------------
test('correct solution + a WRONG self-test still PASSES (self-tests stripped)', () => {
  const withSelfTest = task('agents-01-closures').solution + '\ntest "my own bad check" { expect 1 is 2 }';
  const r = score(task('agents-01-closures'), withSelfTest);
  assert.equal(r.pass, true, r.detail);
});

test('stripTests removes a test block but keeps surrounding code', () => {
  const src = 'agent f(x) { report x }\ntest "t" { expect f(1) is 1 }\nagent g(y) { report y }';
  const out = stripTests(src);
  assert.ok(/agent f/.test(out) && /agent g/.test(out), 'agents survive');
  assert.ok(!/expect/.test(out) && !/test "t"/.test(out), 'the test block is gone');
});

// --- HIGH: execution is fuel-bounded — an infinite loop FAILs, it does not hang the run -------------------
test('an infinite-loop solution FAILs (fuel), never hangs', () => {
  const t = task('data-01-evens');   // any Type A task; the check calls the agent, which loops forever
  const spin = 'agent evens_doubled(xs) { reinforce live { seed z = 1 } report [] }';
  const r = score(t, spin);
  assert.equal(r.pass, false, 'a non-terminating solution must score FAIL, not wedge the harness');
});

// --- MEDIUM: parse-first classification (was mislabeled by a keyword regex) -------------------------------
test('a genuine parse error is classified `parse`', () => {
  const r = score(task('data-01-evens'), 'agent evens_doubled(xs) { report [1, 2, }');   // unbalanced
  assert.equal(r.pass, false);
  assert.equal(r.errClass, 'parse');
});

test('a top-level runtime type error is classified `runtime`, not `parse`', () => {
  // The reviewer's exact repro: parses fine, but `len(5)` throws at runtime — the old keyword classifier
  // mislabeled its "len expected a string, list, or mesh" message as `parse`. Parse-first gets it right.
  const r = score(task('data-01-evens'), 'seed oops = len(5)\nagent evens_doubled(xs) { report xs }');
  assert.equal(r.pass, false);
  assert.equal(r.errClass, 'runtime');
});

test('parseError: null on valid source, message on broken source', () => {
  assert.equal(parseError('agent f(x) { report x }'), null);
  assert.ok(parseError('agent f(x) { report'));
});

// --- MEDIUM: extractNx is multi-block-safe and language-tag-safe (was first-block-only) -------------------
test('extractNx concatenates MULTIPLE nx blocks', () => {
  const reply = 'Here:\n```nx\nagent a(x) { report x }\n```\nand:\n```nx\nagent b(y) { report y }\n```';
  const code = extractNx(reply);
  assert.ok(/agent a/.test(code) && /agent b/.test(code), 'both agents kept');
});

test('extractNx prefers the nx-tagged block over a leading prose block', () => {
  const reply = 'Reasoning:\n```text\nI will define the agent.\n```\nSolution:\n```nx\nagent f(x) { report x }\n```';
  const code = extractNx(reply);
  assert.ok(/agent f/.test(code), 'the nx block is chosen');
  assert.ok(!/I will define/.test(code), 'the prose block is discarded');
});

test('extractNx strips a non-nx language tag from a sole block', () => {
  const code = extractNx('```javascript\nagent f(x) { report x }\n```');
  assert.ok(/^agent f/.test(code), 'no leading "javascript" token: ' + JSON.stringify(code.slice(0, 20)));
});

// --- construct gate helper is word-boundary aware ---------------------------------------------------------
test('missingConstruct matches whole keywords, ignores substrings', () => {
  assert.equal(missingConstruct('report match_helper', ['match']), 'match', 'substring "match" in an identifier does not count');
  assert.equal(missingConstruct('match v { _ { report 1 } }', ['match']), null);
});

// --- CRITICAL (verification adversary): a keyword hidden in a DEAD branch / comment / string must NOT satisfy the gate
test('construct in a `when dead { }` branch does NOT satisfy the gate', () => {
  const cheat = 'agent f(xs) { when dead { seed t = dispatch g(1) gather [t] } seed s = 0 for each x in xs { s = s + x } report s }';
  assert.equal(missingConstruct(cheat, ['dispatch']), 'dispatch', 'a dead-branch keyword must be treated as absent');
  assert.equal(missingConstruct(cheat, ['gather']), 'gather');
});

test('construct in a comment or string does NOT satisfy the gate', () => {
  assert.equal(missingConstruct('agent f(x){ # uses match\n report x }', ['match']), 'match');
  assert.equal(missingConstruct('agent f(x){ report "use match here" }', ['match']), 'match');
});

test('a real `when dead` guard does not hide a LIVE construct elsewhere', () => {
  const real = 'agent f(v) { when dead { emit "x" } match v { _ { report 1 } } }';
  assert.equal(missingConstruct(real, ['match']), null, 'the live match still counts');
});

test('codeMinusNoise strips dead when-literal blocks, comments, and string bodies', () => {
  assert.ok(!/dispatch/.test(codeMinusNoise('when dead { dispatch g(1) }')));
  assert.ok(!/gather/.test(codeMinusNoise('when 0 { gather ts }')));
  assert.ok(!/match/.test(codeMinusNoise('# match\n')));
  assert.ok(!/schedule/.test(codeMinusNoise('"call schedule now"')));
  assert.ok(/match/.test(codeMinusNoise('match v { _ { report 1 } }')), 'live match survives');
});
