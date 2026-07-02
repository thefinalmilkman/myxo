'use strict';
// receipt.test.js — the tamper-evident receipt shared by Warden and JAMES (james_nx_run).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { chain, sealReceipt, verifyChain, hostKey } = require('../receipt');

const AUDIT = [
  { cap: 'db_query', args: ['SELECT 1'], ok: true },
  { cap: 'telegram_send', args: ['hi'], ok: false, error: 'not declared in needs' },
  { cap: 'db_query', args: ['SELECT 2'], ok: true },
];
const KEY = crypto.randomBytes(32);

test('a sealed receipt verifies intact with the host key', () => {
  const r = chain(AUDIT);
  const seal = sealReceipt(r, KEY);
  assert.equal(seal.count, 3);
  assert.equal(verifyChain(r, seal, KEY).ok, true);
});

test('flipping an entry (REFUSE->ALLOW, hiding an overreach) is caught', () => {
  const r = chain(AUDIT);
  const seal = sealReceipt(r, KEY);
  const forged = JSON.parse(JSON.stringify(r));
  forged[1].ok = true; forged[1].error = null;
  const v = verifyChain(forged, seal, KEY);
  assert.equal(v.ok, false);
});

test('truncating the tail (dropping later effects) is caught by the length seal', () => {
  const r = chain(AUDIT);
  const seal = sealReceipt(r, KEY);
  const v = verifyChain(r.slice(0, 2), seal, KEY);
  assert.equal(v.ok, false);
  assert.match(v.why, /length seal/);
});

test('reordering entries breaks the chain', () => {
  const r = chain(AUDIT);
  const seal = sealReceipt(r, KEY);
  const swapped = [r[1], r[0], r[2]];
  assert.equal(verifyChain(swapped, seal, KEY).ok, false);
});

test('re-chaining a doctored ledger + re-sealing without the key is caught (HMAC)', () => {
  const seal = sealReceipt(chain(AUDIT), KEY);                 // the real seal (host key)
  const forgedReceipt = chain(AUDIT.map(e => ({ ...e, ok: true, error: null })));  // attacker rewrites history
  const forgedSeal = sealReceipt(forgedReceipt, crypto.randomBytes(32));           // ...seals with their own key
  // presented against the real seal: root differs; against their seal: HMAC differs vs the host key
  assert.equal(verifyChain(forgedReceipt, seal, KEY).ok, false);
  assert.equal(verifyChain(forgedReceipt, forgedSeal, KEY).ok, false);
});

test('an empty audit still produces a verifiable (count 0) receipt', () => {
  const r = chain([]);
  const seal = sealReceipt(r, KEY);
  assert.equal(seal.count, 0);
  assert.equal(verifyChain(r, seal, KEY).ok, true);
});

test('hostKey prefers an env hex key over generating one', () => {
  const hex = crypto.randomBytes(32).toString('hex');
  process.env.NX_RECEIPT_TEST_KEY = hex;
  const k = hostKey({ env: 'NX_RECEIPT_TEST_KEY' });
  assert.equal(k.toString('hex'), hex);
  delete process.env.NX_RECEIPT_TEST_KEY;
});
