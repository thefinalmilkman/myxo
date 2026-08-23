'use strict';
// myxo-run.js — the production entry for running an agent-written Myxo script behind the
// fence. This is what an MCP tool like `james_nx_run` calls: hand it a script and a
// live tool client, get back structured output + the audit ledger. It never throws —
// a tool handler wants a result object, not an exception.
//
// THREE gates, defense in depth:
//   1. host allowlist  — the host decides which tools are even BRIDGED (absence > refusal)
//   2. the script's `needs` manifest — the script declares what it will touch
//   3. value budgets (`max`/`total`) — the script's own ceilings, runtime-enforced
// Everything privileged lands in the audit ledger, returned even when the run fails.
//
// Optional: pass `receiptKey` to also receive a tamper-evident receipt over the audit ledger.

const { run } = require('./myxo');
const { chain, sealReceipt } = require('./receipt');

// Wrap a live client so only allow-listed tools exist, and a call to anything outside
// the list is hard-stopped at the host boundary (belt to the script-manifest braces).
function gateClient(client, allow) {
  if (!client) return undefined;
  if (!Array.isArray(allow)) return client;             // no allowlist -> bridge everything given
  const set = new Set(allow);
  return {
    tools: (client.tools || []).filter(t => set.has(t.name)),
    call(name, args) {
      if (!set.has(name)) throw new Error(`tool '${name}' is not in the host allowlist`);
      return client.call(name, args);
    },
  };
}

// Run `script` with `client` bridged as fenced capabilities.
// opts: { client, allow, dir, maxDepth, maxSteps, natives, requireManifest, moduleLoader, receiptKey }
// returns: { ok, output, audit, error, receipt? }
function runScript(script, opts = {}) {
  let audit = [];
  const result = { ok: true, output: '', audit, error: null };
  const requireManifest = opts.requireManifest !== undefined ? !!opts.requireManifest : true;
  const moduleLoader = opts.moduleLoader !== undefined ? opts.moduleLoader : null;
  const maxSteps = opts.maxSteps !== undefined ? opts.maxSteps : 200000;
  // Accumulate output OUTSIDE run() so it survives a failing script. With capture:true the chunks
  // died inside the throw and a failed run returned output:'' — everything the script emitted before
  // failing (a monitor's verdict, an agent's partial report) was silently dropped. Evidence survives.
  let buf = '';
  try {
    run(script, {
      output: (s) => { buf += s; },
      dir: opts.dir,
      maxDepth: opts.maxDepth,
      maxSteps,
      requireManifest,
      moduleLoader,
      natives: opts.natives,
      valueCaps: opts.valueCaps,   // caps the host meters by value (e.g. spend); everything else = call-count
      mcp: gateClient(opts.client, opts.allow),
      onAudit: (l) => { audit = result.audit = l; },
    });
  } catch (e) {
    result.ok = false;
    result.error = typeof e.format === 'function' ? e.format() : e.message;
  }
  result.output = buf;
  if (opts.receiptKey) {
    const chained = chain(audit);
    result.receipt = { entries: chained, seal: sealReceipt(chained, opts.receiptKey) };
  }
  return result;
}

module.exports = { runScript, gateClient };
