'use strict';
// lsp.test.js — the Nx language server: pure analysis core + JSON-RPC dispatch + stdio wire.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('stream');
const L = require('../nx-lsp');

// ---- pure analysis ----
test('diagnostics: clean source has none; a syntax error reports line/col/message', () => {
  assert.deepEqual(L.diagnostics('seed n = 5\nemit n'), []);
  const d = L.diagnostics('seed = 5');
  assert.equal(d.length, 1);
  assert.equal(d[0].line, 0);
  assert.ok(d[0].col >= 0);
  assert.match(d[0].message, /expected a name/);
});

test('hover: keywords and builtins documented; plain names are not', () => {
  assert.match(L.hoverAt('seed n = 5', 0, 2), /bind a pathway/);     // on `seed`
  assert.match(L.hoverAt('emit len([1])', 0, 6), /builtin/);          // on `len`
  assert.equal(L.hoverAt('seed n = 5', 0, 5), null);                  // on `n` (a plain name)
});

test('docNames collects seeds, agents, and destructured bindings', () => {
  assert.deepEqual(L.docNames('seed a = 1\nagent f(){ report 1 }\nseed [b, ...c] = [1,2]\nseed { d } = { "d": 1 }').sort(),
    ['a', 'b', 'c', 'd', 'f']);
});

test('completions include file names + keywords + builtins, deduped, names first', () => {
  const c = L.completions('seed myvar = 1');
  assert.ok(c.some(i => i.label === 'myvar' && i.kind === 6));
  assert.ok(c.some(i => i.label === 'seed' && i.kind === 14));
  assert.ok(c.some(i => i.label === 'len' && i.kind === 3));
  assert.equal(new Set(c.map(i => i.label)).size, c.length);          // no duplicates
});

test('formatDoc formats valid source and leaves invalid source alone', () => {
  assert.equal(L.formatDoc('seed   n=5'), 'seed n = 5\n');
  assert.equal(L.formatDoc('seed = bad'), null);
});

// ---- JSON-RPC dispatch ----
const fresh = () => ({ docs: new Map() });

test('initialize advertises hover, completion, and formatting', () => {
  const r = L.handle(fresh(), { id: 1, method: 'initialize', params: {} }).response.result.capabilities;
  assert.equal(r.hoverProvider, true);
  assert.ok(r.completionProvider);
  assert.equal(r.documentFormattingProvider, true);
  assert.equal(r.textDocumentSync, 1);
});

test('didOpen/didChange publish diagnostics for the document', () => {
  const st = fresh();
  const open = L.handle(st, { method: 'textDocument/didOpen', params: { textDocument: { uri: 'f.nx', text: 'seed = bad' } } });
  assert.equal(open.notifications[0].method, 'textDocument/publishDiagnostics');
  assert.equal(open.notifications[0].params.diagnostics.length, 1);
  assert.equal(open.notifications[0].params.diagnostics[0].severity, 1);
  const chg = L.handle(st, { method: 'textDocument/didChange', params: { textDocument: { uri: 'f.nx' }, contentChanges: [{ text: 'seed n = 5' }] } });
  assert.equal(chg.notifications[0].params.diagnostics.length, 0);    // fixed
});

test('hover/completion/formatting respond against the open document', () => {
  const st = fresh();
  L.handle(st, { method: 'textDocument/didOpen', params: { textDocument: { uri: 'f.nx', text: 'seed x = 5\n' } } });   // canonical (trailing newline) so formatting yields no edits
  const hov = L.handle(st, { id: 2, method: 'textDocument/hover', params: { textDocument: { uri: 'f.nx' }, position: { line: 0, character: 1 } } });
  assert.match(hov.response.result.contents.value, /bind a pathway/);
  const comp = L.handle(st, { id: 3, method: 'textDocument/completion', params: { textDocument: { uri: 'f.nx' } } });
  assert.ok(comp.response.result.items.some(i => i.label === 'x'));
  const fmt = L.handle(st, { id: 4, method: 'textDocument/formatting', params: { textDocument: { uri: 'f.nx' } } });
  assert.deepEqual(fmt.response.result, []);                          // already formatted -> no edits
});

test('formatting returns a whole-document TextEdit when reformatting is needed', () => {
  const st = fresh();
  L.handle(st, { method: 'textDocument/didOpen', params: { textDocument: { uri: 'f.nx', text: 'seed   n=5' } } });
  const fmt = L.handle(st, { id: 5, method: 'textDocument/formatting', params: { textDocument: { uri: 'f.nx' } } });
  assert.equal(fmt.response.result.length, 1);
  assert.equal(fmt.response.result[0].newText, 'seed n = 5\n');
});

test('shutdown returns null; an unknown method is a JSON-RPC error', () => {
  assert.equal(L.handle(fresh(), { id: 9, method: 'shutdown' }).response.result, null);
  const err = L.handle(fresh(), { id: 10, method: 'textDocument/nope', params: {} });
  assert.equal(err.response.error.code, -32601);
});

// ---- stdio wire transport ----
test('serve() frames JSON-RPC over stdio (Content-Length)', async () => {
  const input = new PassThrough(), output = new PassThrough();
  const chunks = [];
  output.on('data', (c) => chunks.push(c));
  L.serve(input, output);
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  input.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  await new Promise((r) => setImmediate(r));
  const out = Buffer.concat(chunks).toString('utf8');
  assert.match(out, /Content-Length: \d+\r\n\r\n/);
  assert.match(out, /"capabilities"/);
});

test('formatting PRESERVES comments (it reformats the code and keeps the comment)', () => {
  assert.equal(L.formatDoc('seed   n=5 # note\n'), 'seed n = 5  # note\n');   // no longer refuses — comments survive
  const st = fresh();
  L.handle(st, { method: 'textDocument/didOpen', params: { textDocument: { uri: 'c.nx', text: 'seed   n=5 # note\n' } } });
  const fmt = L.handle(st, { id: 7, method: 'textDocument/formatting', params: { textDocument: { uri: 'c.nx' } } });
  assert.equal(fmt.response.result[0].newText, 'seed n = 5  # note\n');
});

const frameOf = (o) => { const b = JSON.stringify({ jsonrpc: '2.0', ...o }); return `Content-Length: ${Buffer.byteLength(b)}\r\n\r\n${b}`; };

test('serve() handles a split frame and two frames batched in one chunk', async () => {
  const input = new PassThrough(), output = new PassThrough();
  const chunks = []; output.on('data', (c) => chunks.push(c));
  L.serve(input, output);
  const f1 = frameOf({ id: 1, method: 'initialize', params: {} });
  input.write(f1.slice(0, 18)); await new Promise((r) => setImmediate(r));     // split mid-frame across chunks
  input.write(f1.slice(18)); await new Promise((r) => setImmediate(r));
  input.write(frameOf({ id: 2, method: 'shutdown' }) + frameOf({ id: 3, method: 'shutdown' }));   // two in one chunk
  await new Promise((r) => setImmediate(r));
  const out = Buffer.concat(chunks).toString('utf8');
  assert.ok(out.includes('"id":1') && out.includes('"id":2') && out.includes('"id":3'));
});

test('serve() survives a malformed (wrong-shape) message and keeps answering', async () => {
  const input = new PassThrough(), output = new PassThrough();
  const chunks = []; output.on('data', (c) => chunks.push(c));
  L.serve(input, output);
  input.write(frameOf({ id: 1, method: 'textDocument/hover', params: {} }));   // missing textDocument -> handle would throw
  input.write(frameOf({ id: 2, method: 'initialize', params: {} }));
  await new Promise((r) => setImmediate(r));
  const out = Buffer.concat(chunks).toString('utf8');
  assert.ok(out.includes('"id":2') && out.includes('capabilities'));           // survived + answered #2
});
