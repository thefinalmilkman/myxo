'use strict';
// mcp-server.test.js — the MCP provider dispatch (initialize / tools.list / tools.call).
const { test } = require('node:test');
const assert = require('node:assert');
const { Server, ListToolsRequestSchema, CallToolRequestSchema } = require('../mcp-server.js');

function makeServer() {
  const server = new Server({ name: 'test', version: '0.0.1' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{ name: 'echo', description: 'echo back', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => ({
    content: [{ type: 'text', text: 'you said: ' + req.params.arguments.text }],
  }));
  return server;
}

test('initialize echoes the client protocol version and returns serverInfo + capabilities', async () => {
  const s = makeServer();
  const res = await s.handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1' } } });
  assert.strictEqual(res.jsonrpc, '2.0');
  assert.strictEqual(res.id, 1);
  assert.strictEqual(res.result.protocolVersion, '2025-06-18');
  assert.deepStrictEqual(res.result.serverInfo, { name: 'test', version: '0.0.1' });
  assert.ok(res.result.capabilities.tools);
});

test('the initialized notification produces no response', async () => {
  const s = makeServer();
  assert.strictEqual(await s.handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
});

test('tools/list dispatches to the registered handler', async () => {
  const s = makeServer();
  const res = await s.handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  assert.strictEqual(res.id, 2);
  assert.strictEqual(res.result.tools[0].name, 'echo');
});

test('tools/call passes params.name + params.arguments to the handler', async () => {
  const s = makeServer();
  const res = await s.handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { text: 'hi' } } });
  assert.strictEqual(res.id, 3);
  assert.strictEqual(res.result.content[0].text, 'you said: hi');
});

test('an unknown method returns JSON-RPC method-not-found (-32601)', async () => {
  const s = makeServer();
  const res = await s.handleMessage({ jsonrpc: '2.0', id: 4, method: 'no/such', params: {} });
  assert.strictEqual(res.id, 4);
  assert.strictEqual(res.error.code, -32601);
});

test('a throwing handler becomes a JSON-RPC internal error (-32603), not a crash', async () => {
  const s = new Server({ name: 't', version: '1' }, { capabilities: { tools: {} } });
  s.setRequestHandler(CallToolRequestSchema, async () => { throw new Error('boom'); });
  const res = await s.handleMessage({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'x', arguments: {} } });
  assert.strictEqual(res.error.code, -32603);
  assert.match(res.error.message, /boom/);
});
