'use strict';
// plan.test.js — `nx plan`: the capability-preview / fence approval surface. Pure analysis, so exact assertions.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planScript, formatPlan } = require('../nx-plan');

test('a script that declares exactly what it calls is clean', () => {
  const p = planScript('needs db_query, telegram_send(max 1)\nseed r = db_query("x")\ntelegram_send("hi")');
  assert.deepEqual(p.undeclared, []);
  assert.deepEqual(p.unused, []);
  assert.equal(formatPlan(p, 'f').ok, true);
});
test('a referenced-but-undeclared capability is flagged and would be refused', () => {
  const p = planScript('needs db_query\nseed r = db_query("x")\npm2_action("restart")\ntelegram_send("hi")');
  assert.deepEqual(p.undeclared.sort(), ['pm2_action', 'telegram_send']);
  const f = formatPlan(p, 'f');
  assert.equal(f.ok, false);
  assert.match(f.text, /REFUSED at runtime/);
  assert.match(f.text, /pm2_action.*the fence would deny it/);
});
test('it reports the line of an undeclared reference', () => {
  const p = planScript('needs db_query\nseed r = db_query("x")\npm2_action("y")');
  const ref = p.referenced.find(r => r.name === 'pm2_action');
  assert.equal(ref.line, 3);
});
test('no manifest + a capability call is not clean (would run ungoverned / be refused)', () => {
  const f = formatPlan(planScript('spend(50)'), 'f');
  assert.equal(f.ok, false);
  assert.match(f.text, /UNGOVERNED|no .needs. manifest/);
});
test('a pure script (no capabilities) is clean', () => {
  const p = planScript('agent fib(n) { when n < 2 { report n }\n report fib(n-1) + fib(n-2) }\nemit fib(10)');
  assert.deepEqual(p.referenced, []);
  assert.equal(formatPlan(p, 'f').ok, true);
});
test('declared-but-unused capabilities are reported as over-grants (but still clean)', () => {
  const p = planScript('needs db_query, telegram_send, wallet_pay(total 5)\nseed r = db_query("x")');
  assert.deepEqual(p.unused.sort(), ['telegram_send', 'wallet_pay']);
  assert.equal(formatPlan(p, 'f').ok, true);   // over-grant is a smell, not a denial
});
test('a called USER AGENT is not mistaken for a capability', () => {
  const p = planScript('agent helper(x) { report x + 1 }\nemit helper(5)');
  assert.deepEqual(p.referenced, []);
});
test('core builtins are not mistaken for capabilities', () => {
  const p = planScript('emit len(range(5))\nemit upper("hi")');
  assert.deepEqual(p.referenced, []);
});
test('a piped capability call is detected', () => {
  const p = planScript('seed r = "x" | db_query');
  assert.deepEqual(p.undeclared, ['db_query']);
});
test('a capability nested inside a block/agent body is detected', () => {
  const p = planScript('needs notify\nagent run(x) { when x > 0 { alarm("hot") } }\nemit run(1)');
  assert.deepEqual(p.undeclared, ['alarm']);   // declared `notify` is unused; `alarm` is the real (undeclared) reach
  assert.ok(p.unused.includes('notify'));
});
// ---- the gate's findings ----
test('a decoy agent in a nested scope does NOT mask a top-level capability (no false-clean)', () => {
  // adversary FINDING 1: `agent shadow() { agent telegram_send(){} }` (never called) used to suppress detection.
  const p = planScript('agent shadow() {\n agent telegram_send(x) { report x }\n report 0 }\ntelegram_send("leak")');
  assert.deepEqual(p.undeclared, ['telegram_send']);
  assert.equal(formatPlan(p, 'f').ok, false);
});
test('a capability called BEFORE a same-named agent decl is not masked (no hoisting — matches runtime)', () => {
  // re-gate finding: pre-collecting all decls let a later `agent telegram_send` mask an earlier top-level call.
  const p = planScript('telegram_send("leak before decl")\nagent telegram_send(x) { report x }');
  assert.deepEqual(p.undeclared, ['telegram_send']);
  assert.equal(p.referenced.find(r => r.name === 'telegram_send').line, 1);
  assert.equal(formatPlan(p, 'f').ok, false);
});
test('mutual recursion / forward refs still resolve (deferred bodies see the full scope)', () => {
  const p = planScript('agent a(n) { when n <= 0 { report 0 }\n report b(n - 1) }\nagent b(n) { report a(n - 1) }\nemit a(3)');
  assert.deepEqual(p.referenced, []);   // b is a forward ref inside a deferred body — not a capability
});
test('a seed-bound anonymous agent forward-ref is not a false capability (deferred body sees full scope)', () => {
  const p = planScript('seed f = agent() { later() }\nagent later() { report 7 }\nemit f()');
  assert.deepEqual(p.undeclared, []);
});
test('the verdict is right-sized (no soundness over-claim) and the name-masking limit is DISCLOSED', () => {
  // gate lesson: static analysis can't soundly tell a user agent from a same-named capability; say so, don't pretend.
  const f = formatPlan(planScript('agent a() { report 1 }\nemit a()'), 'x');
  assert.equal(f.ok, true);
  assert.doesNotMatch(f.text, /fence covers this script/);        // the removed over-claim
  assert.match(f.text, /best-effort static preview/i);
  assert.match(f.text, /SHARES A NAME with a host capability/);   // the masking blind spot is disclosed
  assert.match(f.text, /RUNTIME FENCE enforces|runtime fence is the actual boundary/i);
});
test('stdlib agents (map/filter/sum/...) are NOT mistaken for capabilities', () => {
  // adversary FINDING 2: std.nx agents were flagged as undeclared host capabilities.
  const p = planScript('seed xs = [3, 1, 2]\nseed t = sum(xs)\nseed e = filter(xs, agent(x) { report x > 1 })\nseed d = map(xs, agent(x) { report x * 2 })\nemit t');
  assert.deepEqual(p.referenced, []);
  assert.equal(formatPlan(p, 'f').ok, true);
});
test('a seed-bound anonymous agent is not a capability', () => {
  // cold #1: `seed f = agent(x){...}` then `f(5)` used to be flagged.
  const p = planScript('seed f = agent(x) { report x + 1 }\nemit f(5)');
  assert.deepEqual(p.referenced, []);
});
test('a nested helper agent called within its own scope is not a capability', () => {
  const p = planScript('agent outer() {\n agent helper() { report 1 }\n report helper() }\nemit outer()');
  assert.deepEqual(p.referenced, []);
});
test('a capability inside a string interpolation reports the correct source line', () => {
  // cold #2: interpolation fragments used to report line 1.
  const ref = planScript('seed a = 1\nseed m = "got {alarm(a)}"').referenced.find(r => r.name === 'alarm');
  assert.equal(ref.line, 2);
});

test('budgets are shown in the declared list', () => {
  const f = formatPlan(planScript('needs wallet_pay(max 2, total 10)\nwallet_pay(1)'), 'f');
  assert.match(f.text, /wallet_pay\s+\(max 2, total 10\)/);
});
