'use strict';
// mcp-framing.test.js — newline-delimited JSON-RPC framing for the MCP wire.
const { test } = require('node:test');
const assert = require('node:assert');
const { MessageBuffer, serialize } = require('../mcp-framing.js');

test('serialize appends exactly one trailing newline', () => {
  assert.strictEqual(serialize({ a: 1 }), '{"a":1}\n');
});

test('serialize never emits an embedded newline (safe to line-delimit)', () => {
  const wire = serialize({ jsonrpc: '2.0', id: 1, result: { text: 'a\nb' } });
  assert.strictEqual(wire.indexOf('\n'), wire.length - 1);
});

test('MessageBuffer parses one full message from a single chunk', () => {
  const b = new MessageBuffer();
  assert.deepStrictEqual(b.push('{"id":1,"method":"ping"}\n'), [{ id: 1, method: 'ping' }]);
});

test('MessageBuffer reassembles a message split across chunks', () => {
  const b = new MessageBuffer();
  assert.deepStrictEqual(b.push('{"id":1,'), []);
  assert.deepStrictEqual(b.push('"method":"ping"}\n'), [{ id: 1, method: 'ping' }]);
});

test('MessageBuffer returns multiple messages and retains a partial tail', () => {
  const b = new MessageBuffer();
  assert.deepStrictEqual(b.push('{"a":1}\n{"b":2}\n{"c":'), [{ a: 1 }, { b: 2 }]);
  assert.deepStrictEqual(b.push('3}\n'), [{ c: 3 }]);
});
