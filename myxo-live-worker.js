'use strict';
// myxo-live-worker.js — the Worker half of myxo-live. It runs the (synchronous) Myxo script,
// and whenever the script invokes a tool it posts the request to the parent and parks on
// Atomics.wait until the parent posts the result back. This is what lets a synchronous
// interpreter call asynchronous tools without the interpreter ever knowing.

const { workerData, parentPort, receiveMessageOnPort } = require('worker_threads');
const { runScript } = require('./myxo-run');

const { script, tools, allow, dir, maxDepth, maxSteps, requireManifest, valueCaps, moduleLoader, sab, port } = workerData;
const signal = new Int32Array(sab);

const client = {
  tools,
  // synchronous from Myxo's view: post -> block -> read the answer the parent left us
  call(name, args) {
    Atomics.store(signal, 0, 0);
    port.postMessage({ type: 'call', name, args });
    Atomics.wait(signal, 0, 0);                 // parked until the parent stores 1 + notifies
    let m = receiveMessageOnPort(port);
    let spins = 0;
    while (!m && spins < 5000000) { m = receiveMessageOnPort(port); spins++; }  // guard delivery lag
    if (!m) throw new Error('no response from host for tool ' + name);
    if (m.message.error) throw new Error(m.message.error);
    return m.message.result;
  },
};

const result = runScript(script, { client, allow, dir, maxDepth, maxSteps, requireManifest, valueCaps, moduleLoader });
parentPort.postMessage({ type: 'done', result });
