'use strict';
// command-fence.test.js — the sub-fence that turns arbitrary exec into structured, injection-proof capabilities.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { commandFence } = require('../command-fence');

const ECHO = path.join(__dirname, 'echo1.ps1');
const echoSpec = (pattern) => ({
  echo1: { argv: ['powershell', '-NoProfile', '-File', ECHO, '{a}'], params: { a: { pattern } } },
});

test('an allowlisted no-param command runs and returns output', () => {
  const nx = commandFence({ whoami: { argv: ['whoami'] } });
  assert.equal(typeof nx.whoami([]), 'string');
  assert.ok(nx.whoami([]).length > 0);
});

test('only allowlisted names exist as capabilities — nothing else', () => {
  const nx = commandFence({ whoami: { argv: ['whoami'] } });
  assert.equal(typeof nx.whoami, 'function');
  assert.equal(nx.format_disk, undefined);
  assert.equal(nx.sh, undefined);
});

test('a valid param passes its policy and the command runs', () => {
  const nx = commandFence(echoSpec('^[a-z]{1,10}$'));
  assert.equal(nx.echo1(['hello']), 'hello');
});

test('an out-of-policy param is REFUSED (nxFence) before the command runs', () => {
  const nx = commandFence(echoSpec('^[a-z]{1,10}$'));
  let threw = null;
  try { nx.echo1(['NOT lowercase 123']); } catch (e) { threw = e; }
  assert.ok(threw, 'should have refused');
  assert.equal(threw.nxFence, true);                 // a policy denial, not a transient failure
  assert.match(threw.message, /fails its policy/);
});

test('an enum param accepts listed values and refuses others', () => {
  const nx = commandFence({ e: { argv: ['powershell', '-NoProfile', '-File', ECHO, '{m}'], params: { m: { enum: ['go', 'stop'] } } } });
  assert.equal(nx.e(['go']), 'go');
  assert.throws(() => nx.e(['maybe']), (err) => err.nxFence === true);
});

test('SHELL INJECTION is structurally inert: a metacharacter arg is passed as literal data (no shell)', () => {
  // permissive policy that PERMITS the metacharacters, so only the no-shell guarantee stands between us and injection
  const nx = commandFence(echoSpec('^[\\w .,&;|()-]{1,60}$'));
  // if the arg were handed to a shell, `& echo INJECTED` would run as a second command; via execFile it is one literal
  const out = nx.echo1(['payload & echo INJECTED']);
  assert.equal(out, 'payload & echo INJECTED');       // returned verbatim -> never shell-parsed
  assert.doesNotMatch(out, /^INJECTED$/m);            // the injected command did not execute
});

test('onEffect receives the RESOLVED argv (what actually ran) for the receipt', () => {
  const seen = [];
  const nx = commandFence(echoSpec('^[a-z]+$'), { onEffect: (name, argv) => seen.push({ name, argv }) });
  nx.echo1(['hi']);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].name, 'echo1');
  assert.equal(seen[0].argv[seen[0].argv.length - 1], 'hi');   // the validated param, substituted in
});

test('a template {slot} with no validated param is rejected at BUILD time (no unchecked substitution)', () => {
  assert.throws(() => commandFence({ bad: { argv: ['echo', '{x}'] } }), /no validated param/);
});

test('a param with neither pattern nor enum is a spec error', () => {
  assert.throws(() => commandFence({ bad: { argv: ['echo', '{x}'], params: { x: {} } } }), /needs a .* policy/);
});

test('the PROGRAM (argv[0]) cannot be a parameter — rejected at build time', () => {
  assert.throws(() => commandFence({ bad: { argv: ['{cmd}', 'x'], params: { cmd: { pattern: '^\\w+$' } } } }), /must be a literal/);
});

test('a param value containing {braces} is NOT re-substituted (no recursive injection)', () => {
  const nx = commandFence(echoSpec('^[\\w{}]+$'));
  assert.equal(nx.echo1(['{a}']), '{a}');   // the literal text, not re-expanded into anything
});
