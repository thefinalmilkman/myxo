'use strict';
// mcp-bridge.js — the seam that makes Myxo the one fenced surface every tool speaks
// through. It turns a catalog of MCP tools into Myxo capabilities: each tool becomes
// a native, and Myxo's manifest (`needs`), value budgets, and audit ledger then
// govern every call. Whatever language or service implements a tool — Python, Rust,
// a shell, an HTTP endpoint, a model — from inside an Myxo script it's just a verb the
// script was granted. That is the mesh: many languages, one law.
//
// The bridge is transport-agnostic on purpose. You hand it a `client`:
//   { tools: [{ name, description, inputSchema }], call(name, argsObject) -> result }
// `call` is SYNCHRONOUS (returns the result, not a Promise). A Node host wrapping a
// live, async MCP server supplies its own sync-invoking shim; Myxo stays pure and the
// fence stays the host's only grant surface. Async-native execution is the next stone.

const { VOID } = require('./interpreter');
const { MyxoError } = require('./errors');

// ---- value mapping: Myxo values <-> plain JS (the wire between worlds) ----------

function nxToJs(v) {
  if (v === VOID || v === undefined) return null;
  if (Array.isArray(v)) return v.map(nxToJs);
  if (v instanceof Map) { const o = {}; for (const [k, val] of v) o[k] = nxToJs(val); return o; }
  return v; // number, string, bool pass straight through
}

function jsToNx(v) {
  if (v === null || v === undefined) return VOID;
  if (Array.isArray(v)) return v.map(jsToNx);
  if (typeof v === 'object') { const m = new Map(); for (const k of Object.keys(v)) m.set(k, jsToNx(v[k])); return m; }
  return v;
}

// Most MCP tools answer with a content envelope: { content: [{type:'text', text}], isError }.
// Unwrap that to the plain text a script wants; surface an error result as an MyxoError so
// it lands in the audit ledger and an enclosing `attempt` can rescue it.
function unwrapResult(res) {
  if (res && typeof res === 'object' && Array.isArray(res.content)) {
    const text = res.content.filter(c => c && c.type === 'text').map(c => c.text).join('\n');
    if (res.isError) throw new MyxoError(text || 'MCP tool reported an error');
    return text;
  }
  return res;
}

// Turn one Myxo call's args into the named-arguments object an MCP tool expects.
// A mesh maps straight to the object; for ergonomics a lone primitive fills the
// tool's first required (or first declared) property, so `query("SELECT ...")` works.
function buildArgs(tool, args) {
  if (args.length === 0) return {};
  const a = args[0];
  if (a instanceof Map) return nxToJs(a);
  const props = tool.inputSchema && tool.inputSchema.properties;
  if (props) {
    const required = (tool.inputSchema.required && tool.inputSchema.required[0]) || Object.keys(props)[0];
    if (required) return { [required]: nxToJs(a) };
  }
  throw new MyxoError(`MCP tool '${tool.name}' needs a mesh of named arguments, e.g. ${tool.name}({ ... })`);
}

// Register every tool in `client` as a fenced Myxo capability on `interp`.
// Returns the list of bridged tool names. After this, an Myxo script reaches each
// tool by name — bounded by its own `needs` manifest and logged in the audit ledger.
function bridgeMcpTools(interp, client) {
  if (!client || !Array.isArray(client.tools) || typeof client.call !== 'function') {
    throw new Error('bridgeMcpTools needs a client: { tools: [...], call(name, args) }');
  }
  for (const tool of client.tools) {
    interp.registerNative(tool.name, (args) => {
      const argObj = buildArgs(tool, args);
      return jsToNx(unwrapResult(client.call(tool.name, argObj)));
    }, true); // capability = true -> fenced by `needs`, recorded in the audit ledger
  }
  return client.tools.map(t => t.name);
}

module.exports = { bridgeMcpTools, nxToJs, jsToNx, unwrapResult };
