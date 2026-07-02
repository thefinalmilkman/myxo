'use strict';
// Host: wire the language runners as FENCED capabilities, run the .nx, print the audit ledger.
const fs = require('fs');
const path = require('path');
const { run } = require('../nx');
const { pycall, pyeval, jscall, jseval, plcall, pleval, sh } = require('../polyglot');

let audit = [];
const src = fs.readFileSync(path.join(__dirname, 'polyglot.nx'), 'utf8');
const out = run(src, {
  capture: true,
  natives: { pycall, pyeval, jscall, jseval, plcall, pleval, sh },   // language runners -> fenced capabilities (gated by `needs`)
  onAudit: (l) => { audit = l; },
});
process.stdout.write(out);
console.log('--- audit ledger (the law saw every cross-language call) ---');
for (const e of audit) console.log(' ', e.cap, e.ok ? 'OK -> ' + e.result : 'REFUSED (' + e.error + ')');
