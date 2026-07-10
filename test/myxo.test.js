'use strict';
// myxo.test.js — unit tests per stage plus end-to-end program runs.
// Pure node:test, zero dependencies.  Run with:  node --test

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { tokenize } = require('../lexer');
const { parse } = require('../parser');
const { run } = require('../myxo');

const out = (src, opts = {}) => run(src, { capture: true, ...opts });

// ---- lexer ----------------------------------------------------------------

test('lexer produces the right token stream', () => {
  const types = tokenize('seed x = 12').map(t => t.type);
  assert.deepEqual(types, ['KEYWORD', 'IDENT', 'ASSIGN', 'NUMBER', 'EOF']);
});

test('lexer tracks line numbers and skips comments', () => {
  const toks = tokenize('# a comment\nemit 1');
  assert.equal(toks[0].value, 'emit');
  assert.equal(toks[0].line, 2);
});

test('lexer keeps multi-char identifiers whole (no keyword bleed)', () => {
  const toks = tokenize('reinforce_path');
  assert.equal(toks[0].type, 'IDENT');
  assert.equal(toks[0].value, 'reinforce_path');
});

// ---- parser ---------------------------------------------------------------

test('parser builds a Seed node', () => {
  const ast = parse('seed x = 1');
  assert.equal(ast.body[0].type, 'Seed');
  assert.equal(ast.body[0].name, 'x');
});

test('parser respects arithmetic precedence', () => {
  const expr = parse('seed x = 2 + 3 * 4').body[0].value;
  assert.equal(expr.type, 'Binary');
  assert.equal(expr.op, '+');
  assert.equal(expr.right.op, '*'); // multiplication binds tighter
});

// ---- expressions & operators ----------------------------------------------

test('arithmetic, precedence, and parens', () => {
  assert.equal(out('emit 2 + 3 * 4'), '14\n');
  assert.equal(out('emit (2 + 3) * 4'), '20\n');
  assert.equal(out('emit 7 % 3'), '1\n');
});

test('strings concatenate across types', () => {
  assert.equal(out('emit "n" + "x"'), 'nx\n');
  assert.equal(out('emit "v" + 2'), 'v2\n');
});

test('booleans render as live/dead and logic short-circuits', () => {
  assert.equal(out('emit live'), 'live\n');
  assert.equal(out('emit 3 > 2'), 'live\n');
  assert.equal(out('emit live and dead'), 'dead\n');
  assert.equal(out('emit dead or live'), 'live\n');
  assert.equal(out('emit not dead'), 'live\n');
});

// ---- control flow ---------------------------------------------------------

test('when / otherwise', () => {
  assert.equal(out('when 1 > 0 { emit "yes" } otherwise { emit "no" }'), 'yes\n');
  assert.equal(out('when 1 > 2 { emit "yes" } otherwise { emit "no" }'), 'no\n');
});

test('reinforce (while loop)', () => {
  assert.equal(out('seed i = 0\nreinforce i < 3 { emit i\ni = i + 1 }'), '0\n1\n2\n');
});

test('reinforce N times (count loop)', () => {
  assert.equal(out('reinforce 3 times { emit "tick" }'), 'tick\ntick\ntick\n');
});

test('for each over a list', () => {
  assert.equal(out('for each x in [10, 20, 30] { emit x }'), '10\n20\n30\n');
});

// ---- agents & closures ----------------------------------------------------

test('agents, recursion, and report', () => {
  const src = 'agent fib(n) { when n < 2 { report n } report fib(n-1) + fib(n-2) }\nemit fib(10)';
  assert.equal(out(src), '55\n');
});

test('first-class anonymous agents close over scope', () => {
  const src = 'agent adder(n) { report agent(x) { report x + n } }\nseed add5 = adder(5)\nemit add5(10)';
  assert.equal(out(src), '15\n');
});

// ---- data structures ------------------------------------------------------

test('lists: index, negative index, mutate', () => {
  assert.equal(out('seed xs = [1, 2, 3]\nemit xs[0]\nemit xs[-1]'), '1\n3\n');
  assert.equal(out('seed xs = [1, 2]\nxs[0] = 9\nemit xs'), '[9, 2]\n');
});

test('mesh: literal, index, missing key is void, decay a key', () => {
  assert.equal(out('seed m = { "a": 1 }\nemit m["a"]'), '1\n');
  assert.equal(out('seed m = { "a": 1 }\nemit m["z"]'), 'void\n');
  assert.equal(out('seed m = { "a": 1, "b": 2 }\ndecay m["a"]\nemit keys(m)'), '["b"]\n');
});

// ---- standard library (self-hosted) ---------------------------------------

test('std.myx: map, filter, reduce, sum, contains', () => {
  assert.equal(out('emit map([1,2,3], agent(x){ report x * 2 })'), '[2, 4, 6]\n');
  assert.equal(out('emit filter([1,2,3,4], agent(x){ report x % 2 == 0 })'), '[2, 4]\n');
  assert.equal(out('emit reduce(range(1,5), 0, agent(a,b){ report a + b })'), '10\n');
  assert.equal(out('emit sum([10, 20, 30])'), '60\n');
  assert.equal(out('emit contains([1,2,3], 2)'), 'live\n');
});

// ---- the Law engine -------------------------------------------------------

test('decaying a pathway removes it', () => {
  assert.throws(() => out('seed x = 1\ndecay x\nemit x'), /unknown pathway/);
});

test('mesh() and prune() embody useful-reinforce / useless-decay', () => {
  const src = [
    'seed keep = 1',
    'seed drop = 1',
    'emit keep',
    'emit keep',
    'emit prune(2)',          // drop (strength 1) falls; keep (read twice) survives
    'emit has(mesh(), "drop")',
    'emit has(mesh(), "keep")',
  ].join('\n');
  assert.equal(out(src), '1\n1\n1\ndead\nlive\n');
});

// ---- errors ---------------------------------------------------------------

test('unknown pathway raises a located MyxoError', () => {
  assert.throws(() => out('emit nope'), (e) =>
    e.name === 'MyxoError' && e.line === 1 && /unknown pathway 'nope'/.test(e.message));
});

test('type errors are caught', () => {
  assert.throws(() => out('emit 1 - "x"'), /needs two numbers/);
});

// ---- embed / host bridge --------------------------------------------------

test('host natives are callable from Myxo', () => {
  const result = run('emit greet("Nexus")', {
    capture: true,
    natives: { greet: (a) => 'hi ' + a[0] },
  });
  assert.equal(result, 'hi Nexus\n');
});

// ---- example programs end-to-end ------------------------------------------

const ex = (name) => fs.readFileSync(path.join(__dirname, '..', 'examples', name), 'utf8');

test('examples/hello.myx', () => {
  assert.equal(out(ex('hello.myx')), 'hello from the Nexus\n');
});

test('examples/fib.myx', () => {
  assert.equal(out(ex('fib.myx')), '0\n1\n1\n2\n3\n5\n8\n13\n21\n34\n');
});

test('examples/nexus.myx', () => {
  assert.equal(
    out(ex('nexus.myx')),
    'strongest pathway: telegram\nbridge pruned — the mesh moved on\nremaining: ["telegram", "wallet"]\n'
  );
});

test('examples/the-law.myx', () => {
  const expected = [
    'telegram reinforced to 5',
    'wallet reinforced to 3',
    'bridge reinforced to 1',
    'telegram reinforced to 5',
    'telegram reinforced to 5',
    'bridge has decayed from the mesh',
    '',
  ].join('\n');
  assert.equal(out(ex('the-law.myx')), expected);
});

test('examples/resilient.myx', () => {
  const expected = [
    'counts: {the: 3, mesh: 2, reinforces: 1, path: 1, keeps: 1}',
    '2',
    'no such pathway: wallet',
    '',
  ].join('\n');
  assert.equal(out(ex('resilient.myx')), expected);
});

// ---- error handling: attempt / rescue / fail ------------------------------

test('attempt rescues a runtime failure and binds the error', () => {
  const src = 'seed xs = [1]\nattempt { emit xs[9] } rescue err { emit "caught: " + err["message"] }';
  assert.match(out(src), /^caught: index 9 is outside/);
});

test('fail raises a failure that rescue catches, with message and value', () => {
  assert.equal(out('attempt { fail "boom" } rescue e { emit e["message"] }'), 'boom\n');
  assert.equal(out('attempt { fail { "code": 42 } } rescue e { emit e["value"]["code"] }'), '42\n');
});

test('attempt with no failure runs clean and skips the rescue', () => {
  assert.equal(out('attempt { emit "ok" } rescue e { emit "never" }'), 'ok\n');
});

test('report still unwinds through attempt (not swallowed as a failure)', () => {
  const src = 'agent f() { attempt { report "early" } rescue e { report "wrong" } }\nemit f()';
  assert.equal(out(src), 'early\n');
});

// ---- value-returning and / or ---------------------------------------------

test('and / or return values, not just booleans (x or default)', () => {
  assert.equal(out('emit void or "fallback"'), 'fallback\n');
  assert.equal(out('emit 5 or 9'), '5\n');
  assert.equal(out('emit 0 and 9'), '0\n');
  assert.equal(out('emit 5 and 9'), '9\n');
  assert.equal(out('emit live and dead'), 'dead\n'); // booleans still render the same
});

// ---- expanded standard library --------------------------------------------

test('string library: split, join, trim, replace, reverse, slice, find', () => {
  assert.equal(out('emit split("a,b,c", ",")'), '["a", "b", "c"]\n');
  assert.equal(out('emit join(["a","b","c"], "-")'), 'a-b-c\n');
  assert.equal(out('emit upper(trim("  hi  "))'), 'HI\n');
  assert.equal(out('emit replace("a.b.c", ".", "/")'), 'a/b/c\n');
  assert.equal(out('emit reverse("nexus")'), 'suxen\n');
  assert.equal(out('emit slice("nexus", 1, 4)'), 'exu\n');
  assert.equal(out('emit find("nexus", "x")'), '2\n');
  assert.equal(out('emit find([10,20,30], 20)'), '1\n');
});

test('math + collection library: sort, round, pow, merge, entries, clamp', () => {
  assert.equal(out('emit sort([3,1,2])'), '[1, 2, 3]\n');
  assert.equal(out('emit sort([3,1,2], agent(a,b){ report b - a })'), '[3, 2, 1]\n');
  assert.equal(out('emit round(3.14159, 2)'), '3.14\n');
  assert.equal(out('emit pow(2, 10)'), '1024\n');
  assert.equal(out('seed m = {"a":1}\nemit merge(m, {"b":2})'), '{a: 1, b: 2}\n');
  assert.equal(out('emit entries({"a":1})'), '[["a", 1]]\n');
  assert.equal(out('emit clamp(15, 0, 10)'), '10\n');
});

// ---- modules: weave / expose (v0.3) ---------------------------------------

const EXDIR = path.join(__dirname, '..', 'examples');

test('examples/use-geo.myx', () => {
  assert.equal(out(ex('use-geo.myx'), { dir: EXDIR }), '12.57\n12\n6.2832\n3.14\n');
});

test('weave imports only exposed names; private names stay private', () => {
  assert.equal(out('weave "geo.myx"\nemit area_rect(3, 4)', { dir: EXDIR }), '12\n');
  assert.throws(() => out('weave "geo.myx"\nemit secret()', { dir: EXDIR }), /unknown pathway 'secret'/);
});

test('weave ... as binds a mesh of the exposed names', () => {
  assert.equal(out('weave "geo.myx" as g\nemit g["area_rect"](2, 5)', { dir: EXDIR }), '10\n');
});

test('weaving is a fenced capability: no loader means no weave', () => {
  assert.throws(() => out('weave "geo.myx"', { dir: EXDIR, moduleLoader: null }), /not granted/);
});

test('circular weave is caught, not infinite', () => {
  assert.throws(() => out('weave "ouroboros.myx"', { dir: EXDIR }), /circular/);
});

// ---- string interpolation (v0.3) ------------------------------------------

test('string interpolation embeds expressions', () => {
  assert.equal(out('seed name = "mesh"\nseed n = 3\nemit "the {name} has {n} paths"'),
    'the mesh has 3 paths\n');
  assert.equal(out('emit "sum is {2 + 3 * 4}"'), 'sum is 14\n');
  assert.equal(out('seed m = {"a": 5}\nemit "got {m["a"]}"'), 'got 5\n');   // nested string in {}
  assert.equal(out('agent dbl(x){ report x*2 }\nemit "dbl(21) = {dbl(21)}"'), 'dbl(21) = 42\n');
});

test('interpolation: escaped braces stay literal', () => {
  assert.equal(out('emit "a \\{literal\\} brace"'), 'a {literal} brace\n');
  assert.equal(out('emit "no braces here"'), 'no braces here\n');           // plain strings unaffected
});

// ---- default & variadic params (v0.3) -------------------------------------

test('default parameters fill in when an argument is omitted', () => {
  const f = 'agent greet(name, greeting = "hi") { report greeting + " " + name }\n';
  assert.equal(out(f + 'emit greet("Myxo")'), 'hi Myxo\n');
  assert.equal(out(f + 'emit greet("Myxo", "yo")'), 'yo Myxo\n');
  // a default can reference an earlier parameter
  assert.equal(out('agent box(w, h = w) { report w * h }\nemit box(5)'), '25\n');
});

test('rest parameters gather the extra arguments as a list', () => {
  assert.equal(out('agent sumall(...xs) { report sum(xs) }\nemit sumall(1, 2, 3, 4)'), '10\n');
  assert.equal(out('agent tag(first, ...rest) { report first + ":" + len(rest) }\nemit tag("a","b","c")'), 'a:2\n');
});

test('arity errors respect required vs optional', () => {
  assert.throws(() => out('agent f(a, b) { report a }\nemit f(1)'), /needs at least 2/);
  assert.throws(() => out('agent f(a) { report a }\nemit f(1, 2)'), /at most 1/);
});

// ---- capabilities: needs manifest + audit ledger (v0.5) -------------------

test('every host-capability call is recorded in the audit ledger', () => {
  let log;
  run('emit lookup("vallartas")', {
    capture: true,
    natives: { lookup: (a) => 'found ' + a[0] },
    onAudit: (l) => { log = l; },
  });
  assert.equal(log.length, 1);
  assert.equal(log[0].cap, 'lookup');
  assert.equal(log[0].ok, true);
  assert.deepEqual(log[0].args, ['vallartas']);
  assert.equal(log[0].result, 'found vallartas');
});

test('a needs manifest fences capabilities: declared works, undeclared is refused', () => {
  const natives = { lookup: (a) => 'ok', spend: (a) => 'spent' };
  assert.equal(run('needs lookup\nemit lookup("x")', { capture: true, natives }), 'ok\n');
  // host GRANTED spend, but the script never declared it -> refused
  assert.throws(() => run('needs lookup\nemit spend(5)', { capture: true, natives }),
    /capability 'spend' is not declared/);
});

test('builtins are not capabilities — free even under a manifest', () => {
  assert.equal(run('needs lookup\nemit len([1,2,3])', { capture: true, natives: { lookup: (a) => 1 } }), '3\n');
});

test('production hosts can require a needs manifest before any capability call', () => {
  let log;
  assert.throws(() => run('emit lookup("x")', {
    capture: true,
    requireManifest: true,
    natives: { lookup: () => 'ok' },
    onAudit: (l) => { log = l; },
  }), /must declare a 'needs' manifest/);
  assert.equal(log[0].cap, 'lookup');
  assert.equal(log[0].ok, false);
  assert.equal(log[0].error, 'missing needs manifest');

  assert.equal(run('emit lookup("x")', {
    capture: true,
    requireManifest: false,
    natives: { lookup: () => 'ok' },
  }), 'ok\n');
});

test('a gated capability records its refusal in the audit', () => {
  let log;
  const natives = { spend: (a) => { if (a[0] > 5) throw new Error('over the $5 cap'); return 'spent ' + a[0]; } };
  assert.throws(() => run('needs spend\nemit spend(9999)',
    { capture: true, natives, onAudit: (l) => { log = l; } }), /\$5 cap/);
  assert.equal(log[0].ok, false);
  assert.match(log[0].error, /\$5 cap/);
});

test('examples/agent.myx — full fence: manifest refusal is caught AND logged', () => {
  let ledger;
  run(ex('agent.myx'), {
    capture: true, dir: EXDIR,
    natives: { lookup: () => "Vallarta's", notify: () => true, spend: (a) => 'spent ' + a[0], purge: () => 'purged' },
    valueCaps: ['spend'],
    onAudit: (l) => { ledger = l; },
  });
  // lookup ok, notify ok, spend(3) ok, spend(1e6) REFUSED by the cap, notify ok,
  // purge REFUSED (granted but undeclared), notify ok
  assert.deepEqual(ledger.map(e => e.cap + ':' + (e.ok ? 'ok' : 'no')),
    ['lookup:ok', 'notify:ok', 'spend:ok', 'spend:no', 'notify:ok', 'purge:no', 'notify:ok']);
});

test('needs cap(max N): a script is bounded by its own declared per-call ceiling', () => {
  // host grants UNLIMITED spend; the script's manifest is what caps it.
  const natives = { spend: (a) => 'spent ' + a[0] };
  const valueCaps = ['spend'];
  assert.equal(run('needs spend(max 5)\nemit spend(5)', { capture: true, natives, valueCaps }), 'spent 5\n');
  let log;
  assert.throws(() => run('needs spend(max 5)\nemit spend(6)',
    { capture: true, natives, valueCaps, onAudit: (l) => { log = l; } }), /per-call max of 5/);
  assert.equal(log[0].ok, false);
  assert.match(log[0].error, /per-call max of 5/);
});

test('examples/outward-gate.myx — the real $5/tx, $15/run policy as a manifest', () => {
  let ledger;
  run(ex('outward-gate.myx'), {
    capture: true, dir: EXDIR,
    natives: { send_sol: (a) => 'sig_' + a[0], notify: () => true },
    valueCaps: ['send_sol'],
    onAudit: (l) => { ledger = l; },
  });
  // three sends fit the $15 run budget; the 4th busts the day, the 5th busts per-tx.
  assert.deepEqual(ledger.filter(e => e.cap === 'send_sol').map(e => e.ok),
    [true, true, true, false, false]);
});

test('needs cap(total N): a cumulative budget counts only successful spends', () => {
  const natives = { spend: (a) => 'spent ' + a[0] };
  // 4 + 4 = 8 <= 10 ok; the third (4) would reach 12 -> refused, budget intact.
  let log;
  const r = run('needs spend(max 5, total 10)\nemit spend(4)\nemit spend(4)\nattempt { spend(4) } rescue e { emit "stopped" }',
    { capture: true, natives, valueCaps: ['spend'], onAudit: (l) => { log = l; } });
  assert.equal(r, 'spent 4\nspent 4\nstopped\n');
  assert.deepEqual(log.map(e => e.cap + ':' + (e.ok ? 'ok' : 'no')), ['spend:ok', 'spend:ok', 'spend:no']);
  assert.match(log[2].error, /total budget of 10/);
});

test('needs value budgets reject negative and NaN numeric spend before the host is called', () => {
  let calls = 0;
  let log;
  const text = run(
    [
      'needs spend(total 10)',
      'attempt { spend(0 - 1) } rescue e { emit e["message"] }',
      'attempt { spend(sqrt(0 - 1)) } rescue e { emit e["message"] }',
    ].join('\n'),
    {
      capture: true,
      natives: { spend: () => { calls++; return 'spent'; } },
      valueCaps: ['spend'],
      onAudit: (l) => { log = l; },
    },
  );
  assert.equal(calls, 0);
  assert.equal(log.length, 2);
  assert.deepEqual(log.map(e => e.ok), [false, false]);
  assert.match(text, /finite non-negative/);
});

// ---- the MCP bridge: every tool becomes a fenced capability ----------------

test('MCP tools become fenced Myxo capabilities, governed by the manifest + ledger', () => {
  const calls = [];
  const client = {
    tools: [
      { name: 'james_db_query',      inputSchema: { properties: { sql:  {} }, required: ['sql'] } },
      { name: 'james_telegram_send', inputSchema: { properties: { text: {} }, required: ['text'] } },
      { name: 'james_pm2_action',    inputSchema: { properties: { action: {} } } },
    ],
    call(name) {
      calls.push(name);
      if (name === 'james_db_query') return { content: [{ type: 'text', text: "Vallarta's" }] };
      return { content: [{ type: 'text', text: 'sent' }] };
    },
  };
  let ledger;
  const text = run(ex('nexus-mesh.myx'), { capture: true, dir: EXDIR, mcp: client, onAudit: (l) => { ledger = l; } });
  assert.match(text, /top lead: Vallarta's/);
  // db + telegram declared -> ran; pm2 undeclared -> refused before the host was ever called
  assert.deepEqual(ledger.map(e => e.cap + ':' + (e.ok ? 'ok' : 'no')),
    ['james_db_query:ok', 'james_telegram_send:ok', 'james_pm2_action:no']);
  assert.deepEqual(calls, ['james_db_query', 'james_telegram_send']); // pm2 never reached the host
});

test('a lone primitive arg fills the MCP tool first required property', () => {
  let seen;
  const client = {
    tools: [{ name: 'q', inputSchema: { properties: { sql: {} }, required: ['sql'] } }],
    call(name, args) { seen = args; return { content: [{ type: 'text', text: 'rows' }] }; },
  };
  assert.equal(run('emit q("SELECT 1")', { capture: true, mcp: client }), 'rows\n');
  assert.deepEqual(seen, { sql: 'SELECT 1' });
});

test('the MCP bridge converts an error result into a rescuable failure', () => {
  const client = {
    tools: [{ name: 'risky', inputSchema: { properties: { x: {} } } }],
    call() { return { content: [{ type: 'text', text: 'upstream exploded' }], isError: true }; },
  };
  let ledger;
  const text = run('attempt { risky("go") } rescue e { emit "caught: " + e["message"] }',
    { capture: true, mcp: client, onAudit: (l) => { ledger = l; } });
  assert.match(text, /caught: upstream exploded/);
  assert.equal(ledger[0].ok, false);
});

test('an MCP capability obeys a needs value budget too', () => {
  const client = {
    tools: [{ name: 'send_sol', inputSchema: { properties: { amount: {} }, required: ['amount'] } }],
    call(name, args) { return { content: [{ type: 'text', text: 'sig_' + args.amount }] }; },
  };
  let ledger;
  // first arg is numeric, so the per-call max applies to the MCP tool as well
  run('needs send_sol(max 5)\nattempt { send_sol(9) } rescue e { emit e["message"] }',
    { capture: true, mcp: client, valueCaps: ['send_sol'], onAudit: (l) => { ledger = l; } });
  assert.equal(ledger[0].ok, false);
  assert.match(ledger[0].error, /per-call max of 5/);
});

// ---- myxo-run: the production runner (the wire) ------------------------------

test('runScript returns structured output + audit and never throws', () => {
  const { runScript } = require('../myxo-run');
  const client = {
    tools: [{ name: 'lookup', inputSchema: { properties: { q: {} }, required: ['q'] } }],
    call() { return { content: [{ type: 'text', text: 'a lead' }] }; },
  };
  const r = runScript('needs lookup\nemit lookup("x")', { client });
  assert.equal(r.ok, true);
  assert.match(r.output, /a lead/);
  assert.equal(r.audit[0].cap, 'lookup');
  // a failing script comes back as a result, not an exception
  const bad = runScript('emit nope', {});
  assert.equal(bad.ok, false);
  assert.match(bad.error, /unknown pathway/);
});

test('runScript host allowlist: an un-listed tool does not even exist', () => {
  const { runScript } = require('../myxo-run');
  const client = {
    tools: [
      { name: 'lookup', inputSchema: { properties: { q: {} } } },
      { name: 'pm2',    inputSchema: { properties: { a: {} } } },
    ],
    call(name) { return { content: [{ type: 'text', text: name + ' ran' }] }; },
  };
  // only `lookup` is bridged; `pm2` is absent regardless of what the script declares
  const r = runScript('needs lookup, pm2\nemit lookup("x")\nattempt { pm2("restart") } rescue e { emit e["message"] }',
    { client, allow: ['lookup'] });
  assert.equal(r.ok, true);
  assert.match(r.output, /lookup ran/);
  assert.match(r.output, /unknown pathway 'pm2'/);   // never bridged -> doesn't exist
  assert.deepEqual(r.audit.map(e => e.cap), ['lookup']);   // pm2 never reached the ledger or the host
});

test('runScript defaults to required needs manifests for bridged capabilities', () => {
  const { runScript } = require('../myxo-run');
  let hostCalls = 0;
  const client = {
    tools: [{ name: 'lookup', inputSchema: { properties: { q: {} }, required: ['q'] } }],
    call() { hostCalls++; return { content: [{ type: 'text', text: 'ok' }] }; },
  };
  const r = runScript('emit lookup("x")', { client });
  assert.equal(r.ok, false);
  assert.equal(hostCalls, 0);
  assert.match(r.error, /must declare a 'needs' manifest/);
  assert.equal(r.audit[0].error, 'missing needs manifest');
});

test('runScript fences weave by default unless the host grants a module loader', () => {
  const { runScript } = require('../myxo-run');
  const r = runScript('weave "geo.myx"', { dir: EXDIR, requireManifest: false });
  assert.equal(r.ok, false);
  assert.match(r.error, /not granted/);
});

// ---- myxo-live: synchronous Myxo over asynchronous tools (the wire) ------------

test('runLive bridges async tools into a synchronous Myxo script', async () => {
  const { runLive } = require('../myxo-live');
  const seen = [];
  const onCall = async (name, args) => {
    await new Promise((r) => setTimeout(r, 5));        // genuinely async work
    seen.push(name);
    if (name === 'lookup') return { content: [{ type: 'text', text: 'Vallarta' }] };
    return { content: [{ type: 'text', text: 'sent' }] };
  };
  const r = await runLive(
    'needs lookup, notify\nseed x = lookup("q")\nnotify(x)\nemit "done " + x',
    {
      tools: [
        { name: 'lookup', inputSchema: { properties: { q: {} } } },
        { name: 'notify', inputSchema: { properties: { t: {} } } },
      ],
      onCall,
    },
  );
  assert.equal(r.ok, true, r.error || '');
  assert.match(r.output, /done Vallarta/);
  assert.deepEqual(r.audit.map((e) => e.cap), ['lookup', 'notify']);
  assert.deepEqual(seen, ['lookup', 'notify']);        // both async tools really ran, in order
});

test('runLive: a budget refusal happens in-worker, before the async host is called', async () => {
  const { runLive } = require('../myxo-live');
  let hostCalls = 0;
  const onCall = async () => { hostCalls++; return { content: [{ type: 'text', text: 'ok' }] }; };
  const r = await runLive(
    'needs send(max 5)\nattempt { send(9) } rescue e { emit e["message"] }',
    { tools: [{ name: 'send', inputSchema: { properties: { amount: {} } } }], onCall, valueCaps: ['send'] },
  );
  assert.equal(r.ok, true);
  assert.match(r.output, /per-call max of 5/);
  assert.equal(hostCalls, 0);                          // the cap fired before the host was touched
  assert.equal(r.audit[0].ok, false);
});

test('runLive has a wall-clock timeout for stalled async tool calls', async () => {
  const { runLive } = require('../myxo-live');
  const r = await runLive(
    'needs wait\nwait("forever")',
    {
      tools: [{ name: 'wait', inputSchema: { properties: { text: {} }, required: ['text'] } }],
      onCall: async () => new Promise(() => {}),
      timeoutMs: 50,
    },
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /timed out/);
});

// ---- stack traces ---------------------------------------------------------

test('a failure inside nested agents carries a stack trace, innermost first', () => {
  const src = 'agent c(x){ report x / 0 }\nagent b(x){ report c(x) }\nagent a(x){ report b(x) }\nemit a(5)';
  assert.throws(() => out(src), (e) => {
    assert.equal(e.name, 'MyxoError');
    assert.equal(e.line, 1);                                  // the failing division
    assert.deepEqual(e.nxStack.map(f => f.name), ['a', 'b', 'c']);  // outermost -> innermost
    const lines = e.format().split('\n');
    assert.match(lines[0], /division by zero/);
    assert.match(lines[1], /in c \(called at line 2\)/);     // render is innermost-first
    return true;
  });
});

test('runaway recursion fails as a clean MyxoError via the depth guard', () => {
  assert.throws(() => out('agent loop(n){ report loop(n+1) }\nemit loop(0)', { maxDepth: 50 }),
    (e) => e.name === 'MyxoError' && /too deep/.test(e.message));
});

test('maxSteps fuel stops runaway loops', () => {
  assert.throws(() => out('reinforce live { }', { maxSteps: 50 }),
    (e) => e.name === 'MyxoError' && /fuel exhausted/.test(e.message));
});

test('a deep trace is truncated, not a wall of frames', () => {
  assert.throws(() => out('agent loop(n){ report loop(n+1) }\nemit loop(0)', { maxDepth: 50 }),
    (e) => {
      const lines = e.format().split('\n');
      assert.ok(lines.length <= 11, 'a deep trace should be capped');
      assert.match(e.format(), /more frame\(s\)/);
      return true;
    });
});

test('the RangeError catch-net converts a native stack overflow to a clean MyxoError', () => {
  // maxDepth set above the JS stack: the depth guard never fires, so the catch-net must.
  assert.throws(() => out('agent loop(n){ report loop(n+1) }\nemit loop(0)', { maxDepth: 999999 }),
    (e) => e.name === 'MyxoError' && /too deep/.test(e.message));
});

// ---- the living mesh (v0.6): hot-promote (memoize) + decay + introspection ----

test('memoized pure recursion is correct and fast (the hot pathway promotes)', () => {
  const t0 = Date.now();
  assert.equal(out('agent fib(n){ when n < 2 { report n }\n report fib(n-1) + fib(n-2) }\nemit fib(28)'), '317811\n');
  assert.ok(Date.now() - t0 < 1500, 'memoized fib(28) should be near-instant (un-memoized ~832k calls)');
});

test('memoization is invisible: same answer with memo on or off', () => {
  const prog = 'agent fib(n){ when n < 2 { report n }\n report fib(n-1) + fib(n-2) }\nemit fib(20)';
  assert.equal(out(prog), '6765\n');
  assert.equal(out(prog), out(prog, { promoteAt: 1e9 }));  // promoteAt huge = never memoize -> identical
});

test('an impure agent (outer write) is NEVER memoized', () => {
  assert.equal(out('seed c = 0\nagent bump(){ c = c + 1\n report c }\nemit bump()\nemit bump()\nemit bump()'), '1\n2\n3\n');
});

test('an agent that reads outer DATA recomputes when that data changes (not stale-cached)', () => {
  assert.equal(out('seed base = 10\nagent add(n){ report n + base }\nemit add(5)\nseed base = 100\nemit add(5)'), '15\n105\n');
});

test('emit inside a memoizable-looking agent fires every call (never cached away)', () => {
  const o = out('agent ping(x){ emit "ping"\n report x }\nemit ping("a")\nemit ping("a")\nemit ping("a")');
  assert.equal((o.match(/ping/g) || []).length, 3);
});

test('recursion (reading your own agent) stays pure and memoizes correctly', () => {
  assert.equal(out('agent fib(n){ when n < 2 { report n }\n report fib(n-1) + fib(n-2) }\nemit fib(15)'), '610\n');
});

test('strength(name) reports pathway heat rising on reads', () => {
  assert.equal(out('seed z = 1\nemit z\nemit z\nemit strength("z")'), '1\n1\n3\n');  // seed=1, +2 reads
  assert.equal(out('emit strength("never_seeded")'), '0\n');
});

test('metabolize(threshold) decays cold pathways, keeps hot', () => {
  const o = out('seed hot = 1\nseed cold = 2\nemit hot\nemit hot\nemit hot\nseed r = metabolize(2)\nemit r["count"]\nemit has(mesh(), "cold")\nemit has(mesh(), "hot")');
  assert.equal(o, '1\n1\n1\n1\ndead\nlive\n');  // cold (strength 1) reaped; hot (strength 4) kept
});

// ---- memoization SOUNDNESS: gate regressions. memo-ON must equal memo-OFF, always. ----
const sameOnOff = (src) => assert.equal(out(src), out(src, { promoteAt: 1e9 }));  // promoteAt huge = memo truly off

test('soundness: a default-param free read is not stale-cached', () => {
  const src = 'seed base=10\nagent f(n, k = base){ report n + k }\nemit f(5)\nemit f(5)\nseed base=100\nemit f(5)';
  assert.equal(out(src), '15\n15\n105\n'); sameOnOff(src);
});
test('soundness: redefining a called agent invalidates the caller cache (epoch)', () => {
  const src = 'agent g(n){ report n + 1 }\nagent f(n){ report g(n) }\nemit f(5)\nemit f(5)\nemit f(5)\nagent g(n){ report n + 100 }\nemit f(5)';
  assert.equal(out(src), '6\n6\n6\n105\n'); sameOnOff(src);
});
test('soundness: a global data write invalidates memo caches (epoch)', () => {
  const src = 'seed g=1\nagent add(n){ report n + g }\nemit add(5)\nemit add(5)\nemit add(5)\nseed g=10\nemit add(5)';
  assert.equal(out(src), '6\n6\n6\n15\n'); sameOnOff(src);
});
test('soundness: strength()/mesh()-reading agents are never memoized', () => {
  const src = 'seed z=1\nagent peek(){ report strength("z") }\nemit peek()\nemit z\nemit z\nemit z\nemit peek()';
  assert.equal(out(src), '1\n1\n1\n1\n4\n'); sameOnOff(src);  // last peek sees live strength, not stale 1
});
test('soundness: VOID and NaN args do not collide in the cache key', () => {
  const src = 'agent id(x){ report x }\nemit type(id(void))\nemit type(id(sqrt(0-1)))\nemit type(id(void))';
  assert.equal(out(src), 'void\nnumber\nvoid\n'); sameOnOff(src);
});
test('soundness: agents with default/rest params are not memoized at all', () => {
  // these run correctly; they are simply never cached (so no key/default holes can bite)
  sameOnOff('seed b=1\nagent d(n, m = b){ report n+m }\nemit d(2)\nemit d(2)\nemit d(2)');
});
test('soundness: reassigning a closed-over agent (non-global) invalidates the caller cache', () => {
  // the recursion exemption lets a memoized caller read a free AGENT taint-free; rebinding it must still invalidate
  const src = 'agent make(){ seed val = agent(){ report 1 }\n seed caller = agent(x){ report val() + x }\n seed a=caller(0)\n seed b=caller(0)\n seed c=caller(0)\n val = agent(){ report 100 }\n seed d=caller(0)\n report str(a)+str(b)+str(c)+str(d) }\nemit make()';
  assert.equal(out(src), '111100\n'); sameOnOff(src);
});

// ---- automatic flow-routing (the slime mold): EWMA conductance, proportional flux, instant failover ----
test('routing fails over from a broken provider to a working one', () => {
  assert.equal(out('agent broken(x){ fail "down" }\nagent good(x){ report x*2 }\nseed r = route("a", [broken, good])\nemit r(21)'), '42\n');
});
test('routing converges to a working provider and away from a failing one', () => {
  assert.equal(out('agent broken(x){ fail "down" }\nagent good(x){ report x*2 }\nseed r = route("b", [broken, good])\nreinforce 8 times { r(1) }\nseed f = flows("b")\nemit f["good"] > f["broken"]'), 'live\n');
});
test('two equally-good providers share traffic (no order lock-in)', () => {
  const o = out('agent A(x){ report "A" }\nagent B(x){ report "B" }\nseed r = route("eq", [A, B])\nseed g = []\nreinforce 100 times { push(g, r(0)) }\nseed na = count(g, agent(v){ report v == "A" })\nemit na > 20, na < 80');
  assert.equal(o, 'live live\n');   // EWMA-by-quality: neither equal provider monopolizes
});
test('a FASTER recovered provider overtakes a slower incumbent (genuine re-balance)', () => {
  // slow is impure (random taints -> never memoized -> stays genuinely slow); fast fails first, then recovers
  assert.equal(out('seed ph=[0]\nagent slow(x){ seed s=random()\n reinforce 500000 times { s = s + 1 }\n report "s" }\nagent fast(x){ when ph[0] < 1 { fail "d" }\n report "f" }\nseed r = route("ov", [slow, fast])\nreinforce 10 times { attempt { r(0) } rescue e { } }\nph[0] = 1\nreinforce 40 times { r(0) }\nseed f = flows("ov")\nemit f["fast"] > f["slow"]'), 'live\n');
});
test('a working provider that starts failing is dropped; traffic shifts to the alternative', () => {
  assert.equal(out('seed ph=[0]\nagent win(x){ when ph[0] > 0 { fail "died" }\n report "win" }\nagent alt(x){ report "alt" }\nseed r = route("dg", [win, alt])\nreinforce 10 times { r(0) }\nph[0] = 1\nseed g = []\nreinforce 6 times { attempt { push(g, r(0)) } rescue e { } }\nemit count(g, agent(v){ report v == "alt" }) >= 5'), 'live\n');
});
test('a route with all providers failing throws (rescuable)', () => {
  assert.equal(out('agent b1(x){ fail "x" }\nagent b2(x){ fail "y" }\nseed r = route("d", [b1, b2])\nattempt { emit r(1) } rescue e { emit "all-down" }'), 'all-down\n');
});
test('the router does NOT route around a fence/policy denial', () => {
  // p1 calls an undeclared capability -> a policy refusal; it must PROPAGATE, not silently fail over to p2
  assert.throws(() => run('needs allowed\nagent p1(x){ forbidden(x) }\nagent p2(x){ report "p2" }\nseed r = route("fz", [p1, p2])\nemit r(1)',
    { capture: true, natives: { allowed: () => 'ok', forbidden: () => 'nope' } }),
    (e) => /not declared/.test(e.message));
});
test('flows(name) introspects the live tube conductances', () => {
  assert.equal(out('agent a(x){ report x }\nagent b(x){ report x }\nseed r = route("e", [a, b])\nr(1)\nemit type(flows("e")), has(flows("e"), "a")'), 'mesh live\n');
});
test('route rejects a non-agent provider', () => {
  assert.throws(() => out('seed r = route("g", [1, 2])'), (e) => /providers must all be agents/.test(e.message));
});
test('re-defining a route name with different providers throws (no silent stale providers)', () => {
  assert.throws(() => out('agent a(x){ report x }\nagent b(x){ report x }\nagent c(x){ report x }\nseed r1 = route("h", [a, b])\nseed r2 = route("h", [a, c])'),
    (e) => /different providers/.test(e.message));
});
