'use strict';
// Formatter tests. The formatter is parser-backed and intentionally refuses unsafe writes
// when comments would be dropped.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { formatSource } = require('../format');
const { parse } = require('../parser');

test('formatSource prints canonical Nx from the AST', () => {
  const src = 'needs spend(max 5,total 15)\nagent fib(n){when n<2{report n}report fib(n-1)+fib(n-2)}\nemit fib(5)';
  assert.equal(formatSource(src), [
    'needs spend(max 5, total 15)',
    'agent fib(n) {',
    '  when n < 2 {',
    '    report n',
    '  }',
    '  report fib(n - 1) + fib(n - 2)',
    '}',
    'emit fib(5)',
    '',
  ].join('\n'));
});

test('formatSource preserves grouping where operator precedence requires it', () => {
  assert.equal(formatSource('emit (2 + 3) * 4\nemit 2 + 3 * 4'), 'emit (2 + 3) * 4\nemit 2 + 3 * 4\n');
});

test('a # inside a string is NOT captured as a comment (no fabrication, idempotent)', () => {
  assert.equal(formatSource('emit "# not a comment"\n'), 'emit "# not a comment"\n');
  const tricky = 'seed s = "{ "x #" } y"\n';   // nested string in interpolation carrying a # (the gate\'s repro)
  assert.equal(formatSource(formatSource(tricky)), formatSource(tricky));   // idempotent, no growing fake comment
});

test('formatSource preserves comments: header, own-line, and trailing', () => {
  const src = '# header\nseed n=5 # trailing\nagent f(){\n# inside\nreport n}\n';
  assert.equal(formatSource(src), [
    '# header',
    'seed n = 5  # trailing',
    'agent f() {',
    '  # inside',
    '  report n',
    '}',
    '',
  ].join('\n'));
});

test('a comment at a block tail stays INSIDE the block (does not escape across the brace)', () => {
  // gate finding: when/otherwise + agent-body tail comments leaked out of their block.
  assert.equal(formatSource('when x {\n  report 1\n  # last in then\n} otherwise {\n  report 2\n}\n'), [
    'when x {', '  report 1', '  # last in then', '} otherwise {', '  report 2', '}', '',
  ].join('\n'));
});
test('a comment trailing a multi-line block attaches to that statement', () => {
  assert.equal(formatSource('when x {\n  report 1\n} # trails the when\nemit 2\n'), [
    'when x {', '  report 1', '}  # trails the when', 'emit 2', '',
  ].join('\n'));
});
test('formatSource handles the concurrency forms (dispatch/gather/spawn/give/take/yield)', () => {
  const src = 'agent w(c) {\n  give 1 to c\n  take x from c\n  yield\n}\nseed t = gather [dispatch w(1)]\nseed f = spawn w(2)\nemit await(f)\n';
  const out = formatSource(src);
  assert.doesNotThrow(() => parse(out));   // re-parseable
  assert.match(out, /give 1 to c/);
  assert.match(out, /take x from c/);
  assert.match(out, /gather \[dispatch w\(1\)\]/);
  assert.match(out, /spawn w\(2\)/);
});
test('formatSource is idempotent on commented source', () => {
  const src = '# a\nseed n = 1  # b\nemit n\n';
  assert.equal(formatSource(formatSource(src)), formatSource(src));
});

test('formatSource with dropComments strips comments', () => {
  assert.equal(formatSource('# gone\nemit 1 # gone too\n', { dropComments: true }), 'emit 1\n');
});

test('CLI fmt --write preserves comments by default; --drop-comments strips them', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nx-fmt-'));
  const file = path.join(dir, 'a.nx');
  fs.writeFileSync(file, '# keep me\nemit 1');
  execFileSync(process.execPath, [path.join(__dirname, '..', 'nx.js'), 'fmt', file, '--write'], { encoding: 'utf8' });
  assert.equal(fs.readFileSync(file, 'utf8'), '# keep me\nemit 1\n');           // comment kept
  execFileSync(process.execPath, [path.join(__dirname, '..', 'nx.js'), 'fmt', file, '--write', '--drop-comments'], { encoding: 'utf8' });
  assert.equal(fs.readFileSync(file, 'utf8'), 'emit 1\n');                      // explicitly stripped
});
