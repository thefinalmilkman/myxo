'use strict';
// mcp-framing.js — newline-delimited JSON message framing for the MCP wire.
//
// The provider-side companion to mcp-bridge.js (which bridges tools INTO Myxo as
// fenced capabilities). This is the transport plumbing for Myxo to SERVE tools over
// MCP: one JSON-RPC value per line. JSON.stringify never emits a raw newline, so
// '\n' is a safe delimiter both ways (server<->client) over stdio.

function serialize(msg) {
  return JSON.stringify(msg) + '\n';
}

// Accumulates incoming text and yields complete JSON messages as they arrive,
// holding any trailing partial line until the rest shows up.
class MessageBuffer {
  constructor() {
    this._buf = '';
  }

  push(chunk) {
    this._buf += chunk;
    const out = [];
    let idx;
    while ((idx = this._buf.indexOf('\n')) !== -1) {
      const line = this._buf.slice(0, idx);
      this._buf = this._buf.slice(idx + 1);
      if (line.trim() === '') continue;
      out.push(JSON.parse(line));
    }
    return out;
  }
}

module.exports = { MessageBuffer, serialize };
