'use strict';
// Standing guard for Myxo's memoization-invisibility invariant: memo-ON (hot-promote) must equal
// memo-OFF, on every program. This runs a seeded, deterministic corpus of memo-stressing programs and
// asserts none diverge — the machine that catches the whole bug-class (router-freeze, prune/metabolize
// ghost-cache, keyOf key-collision) instead of one hand-written repro per bug. The generator + oracle
// live in tools/memo-fuzz.js (also runnable as `node tools/memo-fuzz.js [seed] [count]`). A fixed seed
// means any future regression reproduces byte-for-byte from the failure message.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fuzz } = require('../tools/memo-fuzz');

test('memo-soundness fuzzer: memo-ON == memo-OFF across a seeded 400-program corpus', () => {
  const { checked, violations, byFamily, byFamilyHits } = fuzz({ seed: 0x1CE, count: 400 });
  assert.ok(checked >= 400, `expected >=400 programs, ran ${checked}`);
  // Every family must fire AND actually exercise the memo cache. A family that generates programs but
  // never reaches a cache hit is HOLLOW — it tests nothing, yet reports green. That false-green is
  // exactly how the original `reap` family (a free-DATA read that tainted purity and never promoted)
  // hid a whole unguarded bug-class behind a passing suite. Measure cache-exercise, don't assume it.
  for (const [fam, n] of Object.entries(byFamily)) {
    assert.ok(n > 0, `fuzz family '${fam}' generated 0 programs`);
    assert.ok(byFamilyHits[fam] > 0, `fuzz family '${fam}' is HOLLOW: ${n} programs, 0 reached a memo cache hit`);
  }
  if (violations.length) {
    const v = violations[0];
    assert.fail(
      `memo soundness VIOLATED on ${violations.length}/${checked} programs (first, family=${v.family}):\n` +
      `${v.src}\n  memo-ON : ${JSON.stringify(v.on)}\n  memo-OFF: ${JSON.stringify(v.off)}`
    );
  }
});
