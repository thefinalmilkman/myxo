'use strict';
// cli.test.js — the `nx` command-line surface: help, version, run, fmt, test, errors + exit codes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NX = path.join(__dirname, '..', 'myxo.js');
const VERSION = require('../package.json').version;
const run = (args) => spawnSync('node', [NX, ...args], { encoding: 'utf8', input: '' });   // input:'' so any stdin read EOFs
const tmp = (name, text) => { const p = path.join(os.tmpdir(), `nxcli_${process.pid}_${name}`); fs.writeFileSync(p, text); return p; };

test('--help / -h / help print usage and exit 0', () => {
  for (const a of ['--help', '-h', 'help']) {
    const r = run([a]);
    assert.equal(r.status, 0, a);
    assert.match(r.stdout, /Usage:/);
  }
});

test('--version / -v / version print the package version and exit 0', () => {
  for (const a of ['--version', '-v', 'version']) {
    const r = run([a]);
    assert.equal(r.status, 0, a);
    assert.equal(r.stdout.trim(), VERSION);
  }
});

test('running a file — bare and explicit `run` — executes it', () => {
  const f = tmp('demo.myx', 'emit "hi from cli"\n');
  for (const args of [[f], ['run', f]]) {
    const r = run(args);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /hi from cli/);
  }
  fs.unlinkSync(f);
});

test('a missing file is a clean error (exit 1), not a stack trace', () => {
  const r = run(['definitely_not_here.myx']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no such file/);
  assert.doesNotMatch(r.stderr, /at Object|node:internal/);   // no raw Node stack
});

test('`run` with no file exits 2 with a hint', () => {
  const r = run(['run']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no input file/);
});

test('--strict enforces type contracts from the CLI (exit 1); loose ignores them', () => {
  const f = tmp('strict.myx', 'seed n: number = "bad"\nemit n\n');
  assert.equal(run([f]).status, 0);                            // ignored without --strict
  const s = run([f, '--strict']);
  assert.equal(s.status, 1);
  assert.match(s.stderr, /expects number/);
  fs.unlinkSync(f);
});

test('`fmt` prints canonical source (exit 0)', () => {
  const f = tmp('fmt.myx', 'seed   x=5\n');
  const r = run(['fmt', f]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /seed x = 5/);
  fs.unlinkSync(f);
});

test('`test` exits 0 on pass, 1 on failure', () => {
  const f = tmp('t.myx', 'test "ok" { expect 1 is 1 }\n');
  assert.equal(run(['test', f]).status, 0);
  fs.writeFileSync(f, 'test "bad" { expect 1 is 2 }\n');
  assert.equal(run(['test', f]).status, 1);
  fs.unlinkSync(f);
});

test('a syntax error in a run file is a clean Myxo error (exit 1)', () => {
  const f = tmp('bad.myx', 'seed = 5\n');
  const r = run([f]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Myxo error/);
  fs.unlinkSync(f);
});

// ---- gate regressions: no raw stacks, no silently-dropped flags ----

test('a directory passed as a run file is a clean error, never a raw stack', () => {
  const r = run([os.tmpdir()]);   // a directory
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not a file/);
  assert.doesNotMatch(r.stderr, /at \w|node:internal|EISDIR/);
});

test('fmt on a missing/dir path is a clean error, never a raw stack', () => {
  const miss = run(['fmt', 'no_such_file_xyz.myx']);
  assert.equal(miss.status, 1);
  assert.match(miss.stderr, /no such file/);
  assert.doesNotMatch(miss.stderr, /at \w|node:internal|ENOENT/);
  const dir = run(['fmt', os.tmpdir()]);
  assert.equal(dir.status, 1);
  assert.doesNotMatch(dir.stderr, /at \w|EISDIR/);
});

test('a typo\'d flag is REJECTED, not silently dropped (no false strict pass)', () => {
  const f = tmp('typo.myx', 'seed n: number = "bad"\nemit n\n');
  const r = run([f, '--stict']);          // typo of --strict
  assert.equal(r.status, 2);              // usage error, NOT a green run
  assert.match(r.stderr, /unknown flag/);
  assert.doesNotMatch(r.stdout, /bad/);  // it did NOT run loose and print
  const rf = run(['fmt', f, '--wrte']);  // typo of --write
  assert.equal(rf.status, 2);
  assert.match(rf.stderr, /unknown flag/);
  fs.unlinkSync(f);
});

test('fmt --write actually rewrites the file in place', () => {
  const f = tmp('w.myx', 'seed   x=5\n');
  const r = run(['fmt', f, '--write']);
  assert.equal(r.status, 0);
  assert.equal(fs.readFileSync(f, 'utf8'), 'seed x = 5\n');
  fs.unlinkSync(f);
});
