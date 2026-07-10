'use strict';
// polyglot.test.js — Myxo as the bridge for other languages. Requires `python` on PATH.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const { run } = require('../myxo');
const { pycall, pyeval, jscall, jseval, plcall, pleval, sh, bridgeExec } = require('../polyglot');

const ML = path.join(__dirname, '..', 'examples', 'mathlib.py').replace(/\\/g, '/');
const MLJS = path.join(__dirname, '..', 'examples', 'mathlib.js').replace(/\\/g, '/');
const MLPL = path.join(__dirname, '..', 'examples', 'mathlib.pl').replace(/\\/g, '/');
const out = (src, opts = {}) => run(src, { capture: true, natives: { pycall, pyeval, jscall, jseval, plcall, pleval, sh }, ...opts });
const hasRuntime = (cmd, args = ['--version']) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true });
  return !r.error && r.status === 0;
};
const HAS_PERL = hasRuntime('perl', ['-v']);
const testPerl = (name, fn) => test(name, (t) => {
  if (!HAS_PERL) return t.skip('optional runtime not found on PATH: perl');
  return fn(t);
});

test('Myxo calls a Python function through the fence', () => {
  assert.equal(out(`needs pycall\nemit pycall("${ML}", "add", 2, 3)`), '5\n');
});

test('Python returns a mesh; Myxo reads it (value mapping object<->mesh)', () => {
  assert.equal(out(`needs pycall\nseed s = pycall("${ML}", "stats", [10, 4, 7, 2])\nemit s["sum"], s["max"], s["n"]`), '23 10 4\n');
});

test('pyeval evaluates a Python expression', () => {
  assert.equal(out('needs pyeval\nemit pyeval("2 ** 10")'), '1024\n');
});

test('a Python exception becomes a rescuable Myxo fail', () => {
  assert.equal(out('needs pyeval\nattempt { emit pyeval("1/0") } rescue e { emit "caught" }'), 'caught\n');
});

test('THE LAW governs cross-language calls: an undeclared bridged capability is refused', () => {
  // script needs only pycall; calling sh (granted by host) is refused by the script's own manifest
  assert.throws(() => out('needs pycall\nemit sh("echo nope")'), (e) => /not declared/.test(e.message));
});

test('bridgeExec turns ANY executable into a fenced capability (how a compiled C++/Go/Rust binary plugs in)', () => {
  const o = run('needs pyver\nemit pyver()', { capture: true, natives: { pyver: bridgeExec('python', ['--version']) } });
  assert.match(o, /Python 3/);
});

test('every cross-language call lands in the audit ledger', () => {
  let audit = [];
  run(`needs pycall\nemit pycall("${ML}", "add", 1, 1)`, { capture: true, natives: { pycall }, onAudit: (l) => { audit = l; } });
  assert.equal(audit.length, 1);
  assert.equal(audit[0].cap, 'pycall');
  assert.equal(audit[0].ok, true);
});

// ---- gate regressions: subprocess edges + the honest safety boundary ----

test('a non-finite Python return is a clean rescuable error, not a raw crash', () => {
  assert.equal(out(`needs pycall\nattempt { emit pycall("${ML}", "inf") } rescue e { emit "caught" }`), 'caught\n');
  assert.equal(out('needs pyeval\nattempt { emit pyeval("float(\'nan\')") } rescue e { emit "caught" }'), 'caught\n');
});

test('output written AFTER the result frame cannot spoof it (os._exit defense)', () => {
  assert.equal(out(`needs pycall\nemit pycall("${ML}", "spoof", 99)`), '99\n');  // not "SPOOFED"
});

test('a count budget bounds CALL COUNT for a string-arg verb (total = calls)', () => {
  // sh is count-metered (the default), so `total 2` means at most 2 calls regardless of the arg.
  assert.throws(() => out('needs sh(total 2)\nemit sh("echo a")\nemit sh("echo b")\nemit sh("echo c")'),
    (e) => /budget/.test(e.message));   // the 3rd sh call is refused
});

test('bridgeExec sends a structured arg as JSON, not flattened to [object Object]', () => {
  const echo = bridgeExec('python', ['-c', 'import sys; sys.stdout.write(sys.argv[1])']);
  assert.equal(run('needs echo\nemit echo([1, 2, 3])', { capture: true, natives: { echo } }), '[1,2,3]\n');
});

test('HONEST: pyeval is an arbitrary-code capability (full runtime power, NOT a sandbox)', () => {
  // pins the real boundary: granting pyeval grants Python itself. The fence bounds WHICH verb, not its code.
  assert.match(out("needs pyeval\nemit pyeval(\"__import__('os').name\")"), /nt|posix/);
});

// ---- more languages via the same defineLang factory: Node + Perl, value-mapped through one fenced contract ----

test('Myxo calls a Node function through the fence', () => {
  assert.equal(out(`needs jscall\nemit jscall("${MLJS}", "add", 10, 20)`), '30\n');
});
test('Node returns an object; Myxo reads it as a mesh', () => {
  assert.equal(out(`needs jscall\nseed s = jscall("${MLJS}", "stats", [3, 9, 1])\nemit s["sum"], s["max"], s["n"]`), '13 9 3\n');
});
test('jseval evaluates a Node expression', () => {
  assert.equal(out('needs jseval\nemit jseval("2 ** 10")'), '1024\n');
});
test('a Node exception becomes a rescuable Myxo fail', () => {
  assert.equal(out('needs jseval\nattempt { emit jseval("throw new Error(\'boom\')") } rescue e { emit "caught" }'), 'caught\n');
});

testPerl('Myxo calls a Perl sub through the fence', () => {
  assert.equal(out(`needs plcall\nemit plcall("${MLPL}", "add", 4, 5)`), '9\n');
});
testPerl('Perl returns a hashref; Myxo reads it as a mesh', () => {
  assert.equal(out(`needs plcall\nseed s = plcall("${MLPL}", "stats", [3, 9, 1])\nemit s["sum"], s["max"], s["n"]`), '13 9 3\n');
});
testPerl('pleval evaluates a Perl expression', () => {
  assert.equal(out('needs pleval\nemit pleval("3 * 7")'), '21\n');
});

testPerl('three languages share ONE audit ledger (Myxo is the connective contract)', () => {
  let audit = [];
  out(`needs pycall, jscall, plcall\npycall("${ML}", "add", 1, 1)\njscall("${MLJS}", "add", 1, 1)\nplcall("${MLPL}", "add", 1, 1)`,
    { onAudit: (l) => { audit = l; } });
  assert.deepEqual(audit.map(e => e.cap), ['pycall', 'jscall', 'plcall']);
  assert.ok(audit.every(e => e.ok));
});

// ---- gate regressions: cross-language soundness + honesty ----

test('a shared (diamond) reference is NOT mistaken for a cycle', () => {
  // b = [a, a] shares one list under two slots; it must round-trip, not throw "cyclic"
  assert.equal(out(`needs jscall\nseed a = [1, 2]\nseed b = [a, a]\nseed r = jscall("${MLJS}", "echo", b)\nemit r[0][1], r[1][0]`), '2 1\n');
});
test('a non-finite Node return is a rescuable error, not a silent VOID (consistency with Python/Perl)', () => {
  assert.equal(out('needs jseval\nattempt { emit jseval("1/0") } rescue e { emit "caught" }'), 'caught\n');
});
test('HONEST: jseval is an arbitrary-code capability too (full runtime, not a sandbox)', () => {
  assert.match(out('needs jseval\nemit jseval("process.platform")'), /win32|linux|darwin/);
});
testPerl('HONEST: pleval is an arbitrary-code capability too (full runtime, not a sandbox)', () => {
  assert.match(out('needs pleval\nemit pleval("$^O")'), /MSWin32|cygwin|linux|darwin/);
});
