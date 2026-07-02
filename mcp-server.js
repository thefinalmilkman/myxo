'use strict';
// mcp-server.js — the provider side of MCP for Nx: serve a tool catalog over
// JSON-RPC 2.0. The mirror of mcp-bridge.js (which bridges tools INTO Nx). Ours,
// zero-dependency, drop-in for the low-level @modelcontextprotocol/sdk surface
// (Server + setRequestHandler + the request-schema tags). The stdio transport and
// connect() arrive in the next stone, wired in via handleMessage().

// Request "schemas" are just method tags — setRequestHandler keys off .method,
// so a consumer's `setRequestHandler(ListToolsRequestSchema, fn)` registers fn for
// the 'tools/list' method exactly as the SDK does.
const ListToolsRequestSchema = { method: 'tools/list' };
const CallToolRequestSchema = { method: 'tools/call' };

const DEFAULT_PROTOCOL = '2025-06-18';

class Server {
  constructor(info, opts = {}) {
    this._info = { name: info.name, version: info.version };
    this._capabilities = (opts && opts.capabilities) || {};
    this._handlers = new Map();   // method -> async handler(request, extra)
  }

  setRequestHandler(schema, handler) {
    this._handlers.set(schema.method, handler);
  }

  // Turn one incoming JSON-RPC message into its response object, or null for a
  // notification (no id -> nothing is sent back). Never throws: a handler failure
  // becomes a JSON-RPC error response so the wire keeps moving.
  async handleMessage(msg) {
    if (msg == null || msg.id === undefined || msg.id === null) return null; // notification
    const id = msg.id;
    try {
      if (msg.method === 'initialize') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: (msg.params && msg.params.protocolVersion) || DEFAULT_PROTOCOL,
            capabilities: this._capabilities,
            serverInfo: this._info,
          },
        };
      }
      const handler = this._handlers.get(msg.method);
      if (!handler) {
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${msg.method}` } };
      }
      const result = await handler(msg, {});
      return { jsonrpc: '2.0', id, result };
    } catch (e) {
      return { jsonrpc: '2.0', id, error: { code: -32603, message: (e && e.message) || String(e) } };
    }
  }
}

module.exports = { Server, ListToolsRequestSchema, CallToolRequestSchema, DEFAULT_PROTOCOL };
