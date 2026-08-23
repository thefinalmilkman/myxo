'use strict';
// myxo-live.js — run an Myxo script against ASYNC tools, synchronously.
//
// Myxo's interpreter is synchronous (a tree-walker), but real-world tools — MCP calls,
// HTTP, a database — are async. This bridges that gap with the zero-dependency
// worker+Atomics pattern: the script runs inside a Worker (sync), and every tool call
// round-trips to the parent's async handler. The Worker blocks on `Atomics.wait` until
// the parent posts the result back, so from inside Myxo the call looks like a plain value.
//
// The transport is abstract: you supply `onCall(name, argsObject) -> Promise<result>`.
// Whether that's an in-process MCP dispatch, an HTTP fetch, or a db query, myxo-live does
// not care — which is what lets the same bridge wire into any host (e.g. james_nx_run).

const { Worker, MessageChannel } = require('worker_threads');
const path = require('path');
const { chain, sealReceipt } = require('./receipt');

// runLive(script, opts) -> Promise<{ ok, output, audit, error, receipt? }>
//   opts.tools:   [{ name, inputSchema }]  the catalog to bridge as fenced capabilities
//   opts.onCall:  async (name, argsObject) => result   the real async invoker
//   opts.allow:   optional host allowlist of tool names (defense in depth)
//   opts.dir, opts.maxDepth, opts.maxSteps, opts.requireManifest: passed through to the runner
//   opts.timeoutMs: wall-clock kill switch for the worker (default 30000)
//   opts.receiptKey: optional Buffer; if provided, the audit ledger is sealed in the parent
function runLive(script, opts = {}) {
  const { tools = [], onCall, allow, dir, maxDepth, valueCaps } = opts;
  const requireManifest = opts.requireManifest !== undefined ? !!opts.requireManifest : true;
  const maxSteps = opts.maxSteps !== undefined ? opts.maxSteps : 200000;
  const moduleLoader = opts.moduleLoader !== undefined ? opts.moduleLoader : null;
  const timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : 30000;
  const receiptKey = opts.receiptKey;
  if (typeof onCall !== 'function') {
    return Promise.reject(new Error('runLive needs an async onCall(name, args)'));
  }
  if (typeof moduleLoader === 'function') {
    return Promise.reject(new Error('runLive cannot transfer a function moduleLoader into the worker'));
  }
  return new Promise((resolve, reject) => {
    const sab = new SharedArrayBuffer(4);
    const signal = new Int32Array(sab);
    const { port1, port2 } = new MessageChannel();
    let settled = false;
    let timer = null;

    const worker = new Worker(path.join(__dirname, 'myxo-live-worker.js'), {
      workerData: { script, tools, allow, dir, maxDepth, maxSteps, requireManifest, valueCaps, moduleLoader, sab, port: port2 },
      transferList: [port2],
    });

    const finish = (fn, v) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      port1.close();
      worker.terminate();
      if (receiptKey && v && Array.isArray(v.audit)) {
        const chained = chain(v.audit);
        v.receipt = { entries: chained, seal: sealReceipt(chained, receiptKey) };
      }
      fn(v);
    };
    timer = setTimeout(() => {
      finish(resolve, { ok: false, output: '', audit: [], error: `Myxo run timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    // Each privileged call surfaces here as a 'call' message. Do the async work, post the
    // result back to the Worker, then wake it. The Worker is parked in Atomics.wait.
    port1.on('message', (msg) => {
      if (!msg || msg.type !== 'call') return;
      Promise.resolve()
        .then(() => onCall(msg.name, msg.args))
        .then(
          (result) => { if (!settled) port1.postMessage({ result, error: null }); },
          (e) => { if (!settled) port1.postMessage({ result: null, error: e && e.message ? e.message : String(e) }); },
        )
        .then(() => {
          if (!settled) {
            Atomics.store(signal, 0, 1);
            Atomics.notify(signal, 0);
          }
        });
    });

    worker.on('message', (m) => { if (m && m.type === 'done') finish(resolve, m.result); });
    worker.on('error', (e) => finish(reject, e));
    worker.on('exit', (code) => { if (!settled && code !== 0) finish(reject, new Error('myxo worker exited ' + code)); });
  });
}

module.exports = { runLive };
