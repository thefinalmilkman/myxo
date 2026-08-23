'use strict';
// james-integration.test.js — pin the contract between Myxo and the JAMES MCP surface.
// Mirrors examples/james-myxo-demo.js but exercises the production runners.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { runScript } = require('../myxo-run');
const { runLive } = require('../myxo-live');
const { verifyChain } = require('../receipt');

const tick = () => new Promise((r) => setTimeout(r, 1));

// Stub JAMES handlers that match the real tool contract: args object in, string out.
const HANDLERS = {
  james_db_query: async () => {
    await tick();
    return JSON.stringify({ rowCount: 1, rows: [{ c: 391 }] });
  },
  james_read_notes: async () => {
    await tick();
    return JSON.stringify({ notes: ['note one'] });
  },
  james_approval_request: async (a) => {
    await tick();
    return JSON.stringify({ queued: true, action: a.action, id: 'gate_test' });
  },
};

const TOOLS = [
  { name: 'james_db_query', inputSchema: { properties: { sql: {} }, required: ['sql'] } },
  { name: 'james_read_notes', inputSchema: { properties: { query: {} } } },
  { name: 'james_approval_request', inputSchema: { properties: { action: {}, details: {} }, required: ['action'] } },
];

const SCRIPT = `
needs james_db_query, james_approval_request(total 1)

seed leads = james_db_query("SELECT count(*) AS c FROM leads")
seed ticket = james_approval_request({ "action": "Review lead count", "details": leads })
emit "approval queued: " + ticket

# james_read_notes IS bridged, but THIS script never declared it -> refused
attempt {
  james_read_notes("anything")
} rescue e {
  emit "undeclared blocked: " + e["message"]
}

# james_memory_write was never bridged at all -> it simply does not exist
attempt {
  james_memory_write("quiet write")
} rescue e {
  emit "absent blocked: " + e["message"]
}
`;

const onCall = async (name, a) => {
  const h = HANDLERS[name];
  if (!h) throw new Error(`tool '${name}' is not available to Myxo scripts`);
  return { content: [{ type: 'text', text: await h(a || {}) }] };
};

function assertJamesAudit(audit) {
  const summary = audit.map(e => e.cap + ':' + (e.ok ? 'ok' : 'no'));
  // james_memory_write was never bridged, so it is not a capability and is not logged.
  assert.deepEqual(summary, [
    'james_db_query:ok',
    'james_approval_request:ok',
    'james_read_notes:no',
  ]);
}

test('runScript gates the JAMES surface and returns a complete audit ledger', () => {
  const r = runScript(SCRIPT, { client: { tools: TOOLS, call: onCall }, requireManifest: true });
  assert.equal(r.ok, true);
  assert.match(r.output, /approval queued:/);
  assert.match(r.output, /undeclared blocked:/);
  assert.match(r.output, /absent blocked:/);
  assertJamesAudit(r.audit);
});

test('runScript seals a tamper-evident receipt when given a key', () => {
  const key = crypto.randomBytes(32);
  const r = runScript(SCRIPT, { client: { tools: TOOLS, call: onCall }, receiptKey: key });
  assert.equal(r.ok, true);
  assert(r.receipt, 'receipt should be present');
  assert.equal(r.receipt.entries.length, r.audit.length);
  const v = verifyChain(r.receipt.entries, r.receipt.seal, key);
  assert.equal(v.ok, true);
});

test('runLive gates the JAMES surface across the async worker bridge', async () => {
  const r = await runLive(SCRIPT, { tools: TOOLS, onCall, requireManifest: true });
  assert.equal(r.ok, true);
  assert.match(r.output, /approval queued:/);
  assert.match(r.output, /undeclared blocked:/);
  assert.match(r.output, /absent blocked:/);
  assertJamesAudit(r.audit);
});

test('runLive seals a tamper-evident receipt in the parent process', async () => {
  const key = crypto.randomBytes(32);
  const r = await runLive(SCRIPT, { tools: TOOLS, onCall, requireManifest: true, receiptKey: key });
  assert.equal(r.ok, true);
  assert(r.receipt, 'receipt should be present');
  assert.equal(r.receipt.entries.length, r.audit.length);
  const v = verifyChain(r.receipt.entries, r.receipt.seal, key);
  assert.equal(v.ok, true);
});

test('runScript refuses a script with no needs manifest when requireManifest is true', () => {
  const r = runScript('emit james_db_query("SELECT 1")', { client: { tools: TOOLS, call: onCall }, requireManifest: true });
  assert.equal(r.ok, false);
  assert.match(r.error, /needs/);
  // The bridged-but-undeclared call is still refused and logged.
  assert.equal(r.audit.length, 1);
  assert.equal(r.audit[0].cap, 'james_db_query');
  assert.equal(r.audit[0].ok, false);
});

test('runScript call-count budgets are enforced on JAMES-style capabilities', () => {
  const script = `
needs james_approval_request(total 1)
james_approval_request({ "action": "a" })
james_approval_request({ "action": "b" })
`;
  const r = runScript(script, { client: { tools: TOOLS, call: onCall } });
  assert.equal(r.ok, false);
  const summaries = r.audit.map(e => e.cap + ':' + (e.ok ? 'ok' : 'no'));
  assert.deepEqual(summaries, ['james_approval_request:ok', 'james_approval_request:no']);
});
