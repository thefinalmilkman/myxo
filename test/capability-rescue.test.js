'use strict';
// A FAILING host capability (network refused, host bug, timeout) must be rescuable in-script, exactly
// like a fence denial. Found by the lichen-sentry dogfood (2026-07-02): a raw JS error thrown by a host
// native leaked through attempt/rescue and killed the whole run — a DOWN brain crashed the monitor
// instead of producing its ALERT verdict. interpreter.js now wraps non-MyxoError capability failures.
const { test } = require('node:test');
const assert = require('node:assert');
const nx = require('../myxo');

const natives = {
  boom: () => { throw new Error('connect ECONNREFUSED 127.0.0.1:9999'); },
  fine: () => 'ok',
  throwNull: () => { throw null; },          // a native that throws a non-object (gate repro)
  throwStr: () => { throw 'bare string'; },
  denied: () => { const e = new Error('POLICY: refused'); e.nxFence = true; throw e; }, // command-fence-style plain-Error denial
};

test('a throwing host capability is caught by attempt/rescue', () => {
  const out = nx.run(`
needs boom, fine
attempt {
  boom("x")
  emit "unreachable"
} rescue e {
  emit "rescued: " + e["message"]
}
emit fine("y")
`, { capture: true, natives, requireManifest: true });
  assert.match(out, /rescued: capability 'boom' failed: connect ECONNREFUSED/);
  assert.match(out, /ok/, 'the script continues after rescuing');
  assert.ok(!/unreachable/.test(out), 'the failing call did not fall through');
});

test('the audit ledger records the failure even when rescued', () => {
  let ledger = [];
  nx.run(`
needs boom
attempt { boom("x") } rescue e { }
`, { capture: true, natives, requireManifest: true, onAudit: (l) => { ledger = l; } });
  const entry = ledger.find((e) => e.cap === 'boom');
  assert.ok(entry, 'boom is on the ledger');
  assert.equal(entry.ok, false);
  assert.match(entry.error, /ECONNREFUSED/);
});

test('unrescued, it surfaces as a clean MyxoError (never a raw stack)', () => {
  let threw = null;
  try { nx.run('needs boom\nboom("x")', { capture: true, natives, requireManifest: true }); }
  catch (e) { threw = e; }
  assert.ok(threw, 'still an error when not rescued');
  assert.equal(threw.constructor.name, 'MyxoError');
  assert.match(threw.message, /capability 'boom' failed/);
});

test('runScript returns PARTIAL OUTPUT when the script fails (evidence survives)', () => {
  const { runScript } = require('../myxo-run');
  const r = runScript('needs boom\nemit "verdict: ALERT"\nboom("x")', {
    natives, requireManifest: true, moduleLoader: null,
  });
  assert.equal(r.ok, false);
  assert.match(r.output, /verdict: ALERT/, 'what the script said before failing is not dropped');
  assert.ok(r.audit.some((e) => e.cap === 'boom' && e.ok === false), 'the ledger survives too');
});

test('a plain-Error host failure carries no intentional-failure flag (stays incidental)', () => {
  let threw = null;
  try { nx.run('needs boom\nboom("x")', { capture: true, natives, requireManifest: true }); }
  catch (e) { threw = e; }
  assert.ok(threw);
  assert.ok(!threw.nxFail && !threw.nxFence, 'a host failure is incidental, not an intentional fail/denial');
});

// gate finding (MEDIUM): a native throwing a NON-OBJECT must not escape rescue via a TypeError on .message
test('throw null / throw undefined / throw string are all rescuable (no leaked TypeError)', () => {
  for (const cap of ['throwNull', 'throwStr']) {
    const out = nx.run(`needs ${cap}\nattempt { ${cap}("x") emit "unreachable" } rescue e { emit "rescued " + type(e["message"]) }`,
      { capture: true, natives, requireManifest: true });
    assert.match(out, /rescued string/, cap + ' must be caught with a string message');
    assert.ok(!/unreachable/.test(out));
  }
});

// gate finding (HIGH): a plain-Error policy denial (nxFence) must KEEP its flag through the wrap, so a
// flow-router propagates it instead of routing around the law.
test('a plain-Error nxFence denial keeps its flag (router cannot route around it)', () => {
  let threw = null;
  try { nx.run('needs denied\ndenied("x")', { capture: true, natives, requireManifest: true }); }
  catch (e) { threw = e; }
  assert.ok(threw, 'the denial still propagates');
  assert.equal(threw.nxFence, true, 'nxFence must survive the capability wrap');
  assert.match(threw.message, /POLICY: refused/);
});

test('a routed nxFence denial propagates, it is NOT routed around', () => {
  // route() over two providers; the first is a capability that raises a plain-Error nxFence denial.
  // A denial must PROPAGATE (builtins router honors nxFence), never fail over to the second provider.
  let threw = null;
  try {
    nx.run(`needs denied
agent p1(x) { report denied(x) }
agent p2(x) { report "fell-through" }
seed r = route("t", [p1, p2])
r("go")`, { capture: true, natives, requireManifest: true });
  } catch (e) { threw = e; }
  assert.ok(threw, 'the run must not complete by routing around the denial');
  assert.equal(threw.nxFence, true);
});
