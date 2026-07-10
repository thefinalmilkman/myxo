'use strict';
// types.test.js — gradual types: optional annotations, enforced as runtime contracts only under strict.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../myxo');
const { formatSource } = require('../format');
const loose = (s) => run(s, { capture: true });                 // default: annotations ignored
const strict = (s) => run(s, { capture: true, strict: true });  // --strict: contracts enforced

test('annotations are ignored when not strict (gradual, off by default)', () => {
  assert.equal(loose('seed n: number = "hi"\nemit n'), 'hi\n');
  assert.equal(loose('agent f(x: number){ report x }\nemit f("a")'), 'a\n');
});

test('strict: a typed seed enforces its type', () => {
  assert.equal(strict('seed n: number = 5\nemit n'), '5\n');
  assert.throws(() => strict('seed n: number = "hi"\nemit n'), (e) => /'n' expects number, got string/.test(e.message));
});

test('strict: typed params are checked at the call boundary', () => {
  assert.equal(strict('agent f(x: number){ report x*2 }\nemit f(4)'), '8\n');
  assert.throws(() => strict('agent f(x: number){ report x }\nemit f("a")'), (e) => /param 'x' expects number/.test(e.message));
});

test('strict: the return type is checked', () => {
  assert.equal(strict('agent f(x): number { report x+1 }\nemit f(4)'), '5\n');
  assert.throws(() => strict('agent f(x): string { report 5 }\nemit f(0)'), (e) => /should return string, got number/.test(e.message));
});

test('strict: a param can be both typed and defaulted (name: Type = default)', () => {
  assert.equal(strict('agent f(x: number = 9){ report x }\nemit f(), f(3)'), '9 3\n');
  assert.throws(() => strict('agent f(x: number = 9){ report x }\nemit f("a")'), (e) => /param 'x' expects number/.test(e.message));
});

test('strict: every type name enforces; any opts back into dynamic', () => {
  assert.equal(strict('seed a: list = [1]\nseed m: mesh = {"k":1}\nagent g(){report 1}\nseed h: agent = g\nseed b: bool = live\nemit "ok"'), 'ok\n');
  assert.throws(() => strict('seed m: mesh = [1]'), (e) => /expects mesh, got list/.test(e.message));
  assert.throws(() => strict('seed h: agent = 5'), (e) => /expects agent, got number/.test(e.message));
  assert.equal(strict('seed x: any = "anything"\nemit x'), 'anything\n');
});

test('strict: a typed agent that never reports fails the return contract (got void)', () => {
  assert.throws(() => strict('agent f(): number { emit "side" }\nemit f()'), (e) => /should return number, got void/.test(e.message));
});

test('an unknown type name is a parse error', () => {
  assert.throws(() => loose('seed n: blah = 5'), (e) => /unknown type 'blah'/.test(e.message));
});

test('default params now use `=` and still fill in (migration regression)', () => {
  assert.equal(loose('agent g(name, greeting = "hi"){ report greeting + " " + name }\nemit g("Myxo")'), 'hi Myxo\n');
  assert.equal(loose('agent box(w, h = w){ report w * h }\nemit box(5)'), '25\n');
});

// ---- gate regressions: strict has no escape hatches ----

test('strict: a return-type violation is NOT laundered through the memo cache (F1)', () => {
  assert.throws(() => strict('agent f(x): string { report x }\nemit f(1)'), (e) => /should return string/.test(e.message));
  // every identical call must keep failing — never serve a cached bad value after promotion
  assert.equal(strict('agent f(x): string { report x }\nseed n = 0\nreinforce 3 times { attempt { emit f(1) } rescue e { n = n + 1 } }\nemit n'), '3\n');
  // a valid typed agent still memoizes correctly
  assert.equal(strict('agent sq(n): number { report n*n }\nemit sq(3), sq(3), sq(3)'), '9 9 9\n');
});

test('strict: a typed binding stays typed on reassignment (F2)', () => {
  assert.throws(() => strict('seed n: number = 5\nn = "hi"'), (e) => /'n' expects number/.test(e.message));
  assert.equal(strict('seed n: number = 5\nn = 9\nemit n'), '9\n');               // a valid reassignment is fine
  assert.throws(() => strict('agent f(x: number){ x = "hi"\n report x }\nemit f(1)'), (e) => /'x' expects number/.test(e.message));
});

test('a colon-default migration mistake gets a helpful hint', () => {
  assert.throws(() => loose('agent f(x: 5){ report x }'), (e) => /parameter defaults now use '='/.test(e.message));
});

test('the formatter round-trips type annotations (idempotent)', () => {
  const src = 'seed n: number = 5\nagent f(x: number = 1, y: string): bool {\n  report live\n}\n';
  const f = formatSource(src);
  assert.equal(formatSource(f), f);
  assert.match(f, /seed n: number = 5/);
  assert.match(f, /agent f\(x: number = 1, y: string\): bool/);
});
