'use strict';
// receipt.js -- a tamper-evident RECEIPT over an Nx audit ledger.
//
// An Nx run produces an audit array of { cap, args[], ok, error? } entries (every fenced capability call, allowed or
// refused). This turns that ledger into a proof: a sha256 hash CHAIN (each entry commits the previous), SEALED with an
// HMAC over {count, root} using a HOST-HELD key. In-place edits, reordering, and re-chaining change the root; dropping
// or adding entries changes the count; and neither can be re-sealed without the key. So a saved/shared receipt can be
// verified later as an untampered record of exactly what a (possibly untrusted) script did.
//
// Shared by Warden (warden/warden.js) and JAMES (james_nx_run) so both speak the same receipt.

const crypto = require('crypto');
const fs = require('fs');

const GENESIS = crypto.createHash('sha256').update('nx-receipt-genesis-v1').digest('hex');

// exactly the fields the receipt retains + reconciles on; any change to these breaks the chain
function bodyOf(e) {
  return JSON.stringify({ seq: e.seq, cap: e.cap, args: e.args, ok: e.ok, error: e.error || null });
}

function chain(audit) {
  let prev = GENESIS;
  return (audit || []).map((e, i) => {
    const entry = { seq: i, cap: e.cap, args: e.args, ok: e.ok, error: e.error || null, prev };
    entry.hash = crypto.createHash('sha256').update(prev + bodyOf(entry)).digest('hex');
    prev = entry.hash;
    return entry;
  });
}

// commit LENGTH + final ROOT under an HMAC. Truncation changes count; any edit/re-chain changes root; forging needs the key.
function sealReceipt(receipt, key) {
  const root = receipt.length ? receipt[receipt.length - 1].hash : GENESIS;
  return { count: receipt.length, root, mac: crypto.createHmac('sha256', key).update(receipt.length + ':' + root).digest('hex') };
}

function verifyChain(receipt, seal, key) {
  let prev = GENESIS;
  for (const e of receipt) {
    if (e.prev !== prev) return { ok: false, brokeAt: e.seq, why: 'prev-hash mismatch' };
    const h = crypto.createHash('sha256').update(prev + bodyOf(e)).digest('hex');
    if (h !== e.hash) return { ok: false, brokeAt: e.seq, why: 'entry hash mismatch (tampered)' };
    prev = e.hash;
  }
  if (seal) {
    if (seal.count !== receipt.length) return { ok: false, brokeAt: receipt.length, why: 'length seal mismatch (truncated/extended)' };
    if (seal.root !== prev) return { ok: false, brokeAt: receipt.length, why: 'root seal mismatch' };
    if (key) {
      const good = crypto.createHmac('sha256', key).update(seal.count + ':' + seal.root).digest('hex');
      if (good !== seal.mac) return { ok: false, brokeAt: receipt.length, why: 'HMAC seal mismatch (forged without the key)' };
    }
  }
  return { ok: true, root: prev };
}

// a persistent host key: prefer an env var (hex), else a 0600 keyfile created once. Persistent so receipts verify later.
function hostKey(opts = {}) {
  const envName = opts.env || 'NX_RECEIPT_KEY';
  if (process.env[envName]) return Buffer.from(process.env[envName], 'hex');
  const file = opts.file;
  if (file) {
    try { if (fs.existsSync(file)) return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex'); } catch {}
    const key = crypto.randomBytes(32);
    try { fs.writeFileSync(file, key.toString('hex'), { mode: 0o600 }); } catch {}
    return key;
  }
  return crypto.randomBytes(32);   // ephemeral (verify only within this process)
}

module.exports = { GENESIS, bodyOf, chain, sealReceipt, verifyChain, hostKey };
