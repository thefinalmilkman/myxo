// host.js — the trusted host. It GRANTS a generous set of capabilities to an agent
// script and watches every privileged call through the audit ledger. The point:
// the SCRIPT's own `needs` manifest is what bounds it — not the host's restraint.
//   node examples/host.js
'use strict';
const fs = require('fs');
const path = require('path');
const { run } = require('../myxo');

const src = fs.readFileSync(path.join(__dirname, 'agent.myx'), 'utf8');

let ledger = [];
run(src, {
  dir: __dirname,
  natives: {
    lookup: (a) => "Vallarta's Mexican Grill",                  // a read capability
    notify: (a) => { console.log('  [notify]', a[0]); return true; },
    spend:  (a) => 'spent $' + a[0],                            // host grants UNLIMITED spend...
    purge:  (a) => 'purged ' + a[0],                            // ...and a destructive power
    // The script declared `spend(max 5)` and never declared `purge`, so the
    // runtime caps the spend and refuses the purge — regardless of this generosity.
  },
  onAudit: (l) => { ledger = l; },
});

console.log('\n— audit ledger —');
for (const e of ledger) {
  const tail = e.ok ? '-> ' + e.result : '-> ' + e.error;
  console.log(' ', e.ok ? 'OK ' : 'NO ', e.cap + '(' + e.args.join(', ') + ')', tail);
}
