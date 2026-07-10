// mcp-host.js — the host that bridges a catalog of MCP tools into Myxo as fenced
// capabilities, then runs an agent script through them and reads the audit ledger.
//   node examples/mcp-host.js
//
// The `client` here is a MOCK standing in for the live james-tools MCP server: each
// `call` just returns an MCP-shaped result so the whole path is exercised end to end.
// In the real Nexus this object wraps the actual MCP server (with a sync-invoking shim);
// nothing else about the script or the fence changes.
'use strict';
const fs = require('fs');
const path = require('path');
const { run } = require('../myxo');

const client = {
  tools: [
    { name: 'james_db_query',      inputSchema: { properties: { sql:  { type: 'string' } }, required: ['sql'] } },
    { name: 'james_telegram_send', inputSchema: { properties: { text: { type: 'string' } }, required: ['text'] } },
    { name: 'james_pm2_action',    inputSchema: { properties: { action: {}, process: {} } } },
  ],
  call(name, args) {
    if (name === 'james_db_query')      return { content: [{ type: 'text', text: "Vallarta's Mexican Grill" }] };
    if (name === 'james_telegram_send') { console.log('  [telegram]', args.text); return { content: [{ type: 'text', text: 'sent' }] }; }
    if (name === 'james_pm2_action')    return { content: [{ type: 'text', text: 'restarted' }] };
    return { content: [{ type: 'text', text: 'ok' }] };
  },
};

const src = fs.readFileSync(path.join(__dirname, 'nexus-mesh.myx'), 'utf8');

let ledger = [];
run(src, { dir: __dirname, mcp: client, onAudit: (l) => { ledger = l; } });

console.log('\n— audit ledger —');
for (const e of ledger) {
  const tail = e.ok ? '-> ' + e.result : '-> ' + e.error;
  console.log(' ', e.ok ? 'OK ' : 'NO ', e.cap + '(' + e.args.join(', ') + ')', tail);
}
