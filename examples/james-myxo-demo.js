// james-myxo-demo.js — exactly what the `james_nx_run` MCP handler does, runnable WITHOUT
// JAMES up. The HANDLERS here are stubs that mirror the real JAMES tools' contract (take
// an args object, return a string, sync or async). Proves the wire's behavior end to end:
// a local model's script reaches only the safe, allow-listed tools, async tools are called
// synchronously, and every privileged move — including refusals — lands in the audit ledger.
//   node examples/james-myxo-demo.js
'use strict';
const { runLive } = require('../myxo-live');

const tick = () => new Promise((r) => setTimeout(r, 3));

// stand-ins for the read/approval-only JAMES Myxo surface.
const HANDLERS = {
  james_db_query:         async () => { await tick(); return JSON.stringify({ rowCount: 1, rows: [{ c: 391 }] }); },
  james_read_notes:       async () => { await tick(); return JSON.stringify({ notes: ['...'] }); },
  james_approval_request: async (a) => { await tick(); return JSON.stringify({ queued: true, action: a.action, id: 'gate_demo' }); },
};
const tools = [
  { name: 'james_db_query',         inputSchema: { properties: { sql: {} }, required: ['sql'] } },
  { name: 'james_read_notes',       inputSchema: { properties: { query: {} } } },
  { name: 'james_approval_request', inputSchema: { properties: { action: {}, details: {} }, required: ['action'] } },
];
const onCall = async (name, a) => {
  const h = HANDLERS[name];
  if (!h) throw new Error(`tool '${name}' is not available to Myxo scripts`);
  return { content: [{ type: 'text', text: await h(a || {}) }] };
};

// The kind of script a local model would write. It declares exactly what it touches.
const script = `
needs james_db_query, james_approval_request(total 1)

seed leads = james_db_query("SELECT count(*) AS c FROM leads")
seed ticket = james_approval_request({ "action": "Review lead count", "details": leads })
emit "approval queued: " + ticket

# james_read_notes IS available to this tool, but THIS script never declared it -> refused
attempt {
  james_read_notes("anything")
} rescue e {
  emit "undeclared blocked: " + e["message"]
}

# direct writes/comms and pm2 were never bridged into the safe set at all -> they simply do not exist
attempt {
  james_memory_write("quiet write")
} rescue e {
  emit "absent blocked: " + e["message"]
}
`;

(async () => {
  const r = await runLive(script, { tools, onCall });
  console.log('\nok:', r.ok);
  console.log('output:\n' + (r.output || '').trimEnd());
  console.log('\n- audit ledger -');
  for (const e of r.audit) {
    console.log(' ', e.ok ? 'OK ' : 'NO ', e.cap + '(' + e.args.join(', ') + ')  ->', e.ok ? e.result : e.error);
  }
})();
