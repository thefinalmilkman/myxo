'use strict';
// myxo-lsp.js — a minimal Language Server for Myxo (stdio JSON-RPC, LSP 3.x).
// v1 scope: diagnostics (parse/syntax errors), hover (keyword + builtin docs), completion
// (keywords + builtins + TOP-LEVEL names in the file), and formatting (comment-preserving).
// The analysis core (diagnostics/hoverAt/completions/docNames/formatDoc) is pure and unit-tested;
// `handle` is a pure JSON-RPC dispatcher; `serve` is the thin stdio transport.
// HONEST scope: syntax/parse diagnostics ONLY — a parseable-but-semantically-broken file shows NO squiggles
// (type/runtime errors surface only at run time). Completion offers top-level names, NOT scope-aware. No
// go-to-definition / references / rename / document-symbols. Single-file; not yet run in a live editor.

const { parse } = require('./parser');
const { MyxoError } = require('./errors');
const { KEYWORDS } = require('./lexer');
const { formatSource } = require('./format');
const { makeInterpreter } = require('./myxo');

// ---- name tables -----------------------------------------------------------

let NAMES = null;
function builtinNames() {                       // builtins + self-hosted stdlib, straight from a booted interpreter
  if (NAMES) return NAMES;
  try { NAMES = [...makeInterpreter().globals.vars.keys()].sort(); }
  catch { NAMES = []; }
  return NAMES;
}

const KEYWORD_DOCS = {
  seed: 'seed name = value — bind a pathway (seed name: Type = value to type it).',
  decay: 'decay name — remove a pathway (or decay x[i] for a slot).',
  emit: 'emit a, b, ... — print the values, space-joined.',
  when: 'when cond { ... } otherwise { ... } — conditional.',
  otherwise: 'otherwise { ... } / otherwise when ... — the else of a when.',
  reinforce: 'reinforce cond { ... } (while) · reinforce N times { ... } (repeat).',
  times: 'reinforce N times { ... } — repeat a block N times.',
  for: 'for each x in iterable { ... } — iterate a list/mesh/string.',
  each: 'for each x in iterable { ... }.',
  in: 'for each x in iterable { ... }.',
  agent: 'agent name(params) { body } — define an agent (closure). : Type for a return type.',
  report: 'report expr — return a value from the enclosing agent.',
  attempt: 'attempt { ... } rescue err { ... } — catch a failure (err is a mesh).',
  rescue: 'rescue err { ... } — handle a failure from attempt.',
  fail: 'fail expr — raise a failure an enclosing attempt can rescue.',
  weave: 'weave "path" [as alias] — import a module strand (fenced).',
  expose: 'expose name — make a pathway public for weaving.',
  as: 'weave "path" as alias — namespace the imported names.',
  needs: 'needs cap, cap(max N, total M) — declare/limit capabilities.',
  live: 'live — boolean true.',
  dead: 'dead — boolean false.',
  void: 'void — the empty value (also a type name).',
  and: 'a and b — returns a if dead, else b (value-returning, short-circuit).',
  or: 'a or b — returns a if live, else b (so `x or default`).',
  not: 'not x — boolean negation.',
  test: 'test "name" { expect ... } — a test case (runs under `myxo test`).',
  expect: 'expect e [is v | is not v | to fail | to fail with "s"] — an assertion.',
  match: 'match subject { pattern { ... } _ { ... } } — pattern matching.',
};

// ---- pure analysis (unit-tested) -------------------------------------------

// Parse the text; return LSP-shaped diagnostics (0-based line/char). Syntax-level only.
function diagnostics(text) {
  try { parse(text); return []; }
  catch (e) {
    const line = (typeof e.line === 'number' ? e.line : 1) - 1;
    const col = (typeof e.col === 'number' ? e.col : 1) - 1;
    return [{ line: Math.max(0, line), col: Math.max(0, col), message: e.message }];
  }
}

const isWordChar = (c) => /[A-Za-z0-9_]/.test(c || '');

// The identifier/keyword token straddling a 0-based (line, character), or '' .
function wordAt(text, line, character) {
  const lines = text.split('\n');
  const src = lines[line];
  if (src == null) return '';
  let s = character, e = character;
  while (s > 0 && isWordChar(src[s - 1])) s--;
  while (e < src.length && isWordChar(src[e])) e++;
  return src.slice(s, e);
}

function hoverAt(text, line, character) {
  const w = wordAt(text, line, character);
  if (!w) return null;
  if (KEYWORD_DOCS[w]) return KEYWORD_DOCS[w];
  if (builtinNames().includes(w)) return `${w} — Myxo builtin/stdlib agent.`;
  return null;
}

// Names declared in this file: seeded pathways, agents, and destructured bindings.
function docNames(text) {
  let ast;
  try { ast = parse(text); } catch { return []; }
  const out = new Set();
  const fromPattern = (p) => {
    if (!p) return;
    if (p.type === 'PBind') out.add(p.name);
    else if (p.type === 'PList') { p.elements.forEach(fromPattern); if (p.rest) out.add(p.rest); }
    else if (p.type === 'PMesh') p.pairs.forEach(pr => fromPattern(pr.pattern));
  };
  for (const s of ast.body) {
    if (s.type === 'Seed') out.add(s.name);
    else if (s.type === 'Agent') out.add(s.name);
    else if (s.type === 'SeedDestructure') fromPattern(s.pattern);
  }
  return [...out];
}

// LSP CompletionItemKind: Function=3, Variable=6, Keyword=14.
function completions(text) {
  const items = [];
  for (const n of docNames(text)) items.push({ label: n, kind: 6, detail: 'in this file' });
  for (const k of KEYWORDS) items.push({ label: k, kind: 14, detail: 'keyword' });
  for (const b of builtinNames()) items.push({ label: b, kind: 3, detail: 'builtin' });
  const seen = new Set(), out = [];
  for (const it of items) { if (!seen.has(it.label)) { seen.add(it.label); out.push(it); } }   // doc names win
  return out;
}

function formatDoc(text) {
  try { return formatSource(text); } catch { return null; }   // comments are preserved now; just don't reformat invalid source
}

// ---- JSON-RPC dispatch (pure: state + message -> { response?, notifications? }) ----

function lspDiagnostics(text) {
  return diagnostics(text).map(d => ({
    range: { start: { line: d.line, character: d.col }, end: { line: d.line, character: d.col + 1 } },
    severity: 1,                                  // Error
    source: 'myxo',
    message: d.message,
  }));
}

function handle(state, msg) {
  const { id, method, params } = msg;
  const docs = state.docs;
  const textOf = (p) => docs.get(p && p.textDocument && p.textDocument.uri);
  const publish = (uri) => ({ method: 'textDocument/publishDiagnostics', params: { uri, diagnostics: lspDiagnostics(docs.get(uri) || '') } });

  switch (method) {
    case 'initialize':
      return { response: { id, result: {
        serverInfo: { name: 'myxo-lsp', version: '1.0' },
        capabilities: {
        textDocumentSync: 1,                      // full-document sync
        hoverProvider: true,
        completionProvider: { triggerCharacters: [] },
        documentFormattingProvider: true,
      } } } };
    case 'initialized': return {};
    case 'textDocument/didOpen': {
      const uri = params.textDocument.uri;
      docs.set(uri, params.textDocument.text || '');
      return { notifications: [publish(uri)] };
    }
    case 'textDocument/didChange': {
      const uri = params.textDocument.uri;
      const last = params.contentChanges[params.contentChanges.length - 1];
      docs.set(uri, last ? last.text : (docs.get(uri) || ''));   // full sync: last change is the whole doc
      return { notifications: [publish(uri)] };
    }
    case 'textDocument/didClose':
      docs.delete(params.textDocument.uri);
      return {};
    case 'textDocument/hover': {
      const h = hoverAt(textOf(params) || '', params.position.line, params.position.character);
      return { response: { id, result: h ? { contents: { kind: 'plaintext', value: h } } : null } };
    }
    case 'textDocument/completion':
      return { response: { id, result: { isIncomplete: false, items: completions(textOf(params) || '') } } };
    case 'textDocument/formatting': {
      const text = textOf(params) || '';
      const f = formatDoc(text);
      if (f == null || f === text) return { response: { id, result: [] } };
      const lines = text.split('\n');
      const end = { line: lines.length - 1, character: lines[lines.length - 1].length };
      return { response: { id, result: [{ range: { start: { line: 0, character: 0 }, end }, newText: f }] } };
    }
    case 'shutdown': state.shuttingDown = true; return { response: { id, result: null } };
    case 'exit': return { exit: true, code: state.shuttingDown ? 0 : 1 };   // LSP: exit before shutdown is an error
    default:
      return id != null ? { response: { id, error: { code: -32601, message: `method not found: ${method}` } } } : {};
  }
}

// ---- stdio transport -------------------------------------------------------

function serve(input = process.stdin, output = process.stdout) {
  const state = { docs: new Map() };
  let buf = Buffer.alloc(0);
  const send = (obj) => {
    const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...obj }), 'utf8');
    output.write(`Content-Length: ${body.length}\r\n\r\n`);
    output.write(body);
  };
  input.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const headerEnd = buf.indexOf('\r\n\r\n');
      if (headerEnd < 0) break;
      const header = buf.slice(0, headerEnd).toString('utf8');
      const m = /Content-Length:\s*(\d+)/i.exec(header);
      if (!m) { buf = buf.slice(headerEnd + 4); continue; }
      const len = parseInt(m[1], 10);
      const start = headerEnd + 4;
      if (buf.length < start + len) break;             // wait for the full body
      const body = buf.slice(start, start + len).toString('utf8');
      buf = buf.slice(start + len);
      let msg;
      try { msg = JSON.parse(body); } catch { continue; }
      let out;
      try { out = handle(state, msg); }   // a malformed/unexpected message must never kill the server
      catch (e) {
        if (msg && msg.id != null) send({ id: msg.id, error: { code: -32603, message: 'internal error: ' + e.message } });
        continue;
      }
      if (out.response) send(out.response);
      if (out.notifications) for (const n of out.notifications) send(n);
      if (out.exit) process.exit(out.code || 0);
    }
  });
}

module.exports = { diagnostics, wordAt, hoverAt, docNames, completions, formatDoc, handle, serve, KEYWORD_DOCS };
