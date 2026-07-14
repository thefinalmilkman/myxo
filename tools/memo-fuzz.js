'use strict';
// ---------------------------------------------------------------------------------------------------
// Memo-soundness differential fuzzer for Myxo.
//
// Myxo's load-bearing promise: memoization is INVISIBLE. A program's output with the hot-promotion
// memoizer ON (promoteAt = 2) must equal its output with it OFF (promoteAt = 1e9). Every memo bug we
// have found is a violation of exactly that equality:
//     router-freeze .......... a pure agent wrapping route() cached the router's first pick forever
//     prune/metabolize ghost .. a reaped/rebound dependency kept being served from a stale cache
//     keyOf collision ......... two distinct arg lists forged the same memo key (\x1f join; -0 vs 0)
// Instead of one hand-written repro per bug, we GENERATE programs that stress the memoizer, run each
// ON and OFF, and flag any that disagree. It reproduces the router and keyOf classes on its own when
// their fixes are reverted (see `node tools/memo-fuzz.js` against a reverted build), and the `reap`
// family guards the epoch-invalidation class the same way.
//
// HONEST SCOPE: the invariant is "memo-invisible EXCEPT for documented mesh introspection" — strength()
// / mesh() / metabolize()-return values are deliberately allowed to observe promotion (interpreter.js
// disclaims mesh-strength invisibility). The generators therefore never EMIT those introspection values,
// so the ON==OFF oracle stays a true soundness test and not a false alarm on intended behavior.
//
// COVERAGE IS MEASURED, NOT ASSUMED: each program's ON run reports its real memo cache-hit count, and a
// family that never exercises the cache (hollow) is a test failure — that is exactly how the original
// `reap` family (a free-DATA read that tainted purity and never promoted) hid behind a green suite.
//
// Pure JS, zero deps. Deterministic (seeded PRNG) so every failure reproduces byte-for-byte.
// ---------------------------------------------------------------------------------------------------

const { makeInterpreter } = require('../myxo');
const { parse } = require('../parser');

// --- deterministic PRNG (mulberry32) ---------------------------------------------------------------
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rnd, xs) => xs[Math.floor(rnd() * xs.length)];
const rint = (rnd, lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

// --- run one program and report output + program-attributable memo cache HITS ----------------------
// Replicates myxo.run()'s capture mode, but keeps the interpreter so we can read its memo records.
// Boot hits (stdlib promoting during install) are discounted so `hits` reflects only the program.
function runStats(src, promoteAt) {
  const chunks = [];
  const interp = makeInterpreter({ output: (s) => chunks.push(s), promoteAt });
  let base = 0;
  for (const rec of interp.memo.values()) base += rec.hits;
  let r;
  try { interp.run(parse(src)); r = { ok: true, v: chunks.join('') }; }
  catch (e) { r = { ok: false, v: String((e && e.message) || e) }; }
  let hits = 0;
  for (const rec of interp.memo.values()) hits += rec.hits;
  r.hits = hits - base;
  return r;
}

// --- the oracle: one ON-vs-OFF differential run ----------------------------------------------------
function differential(src) {
  const on = runStats(src, 2);        // memoizer ON (default hot-promote threshold)
  const off = runStats(src, 1e9);     // memoizer effectively OFF
  const violation = (on.ok !== off.ok || on.v !== off.v) ? { on, off } : null;
  return { violation, onHits: on.hits };
}

// "nasty" bytes: content that looks like keyOf's own tags/separator — most able to forge a key boundary.
const SEP = '\x1f';
// Myxo string literal preserving RAW bytes (incl. control bytes like \x1f). JSON.stringify would escape
// \x1f to a 6-char sequence and defuse the very collision we hunt; only " and \ need escaping.
const q = (s) => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

// --- FAMILY: keyOf boundary-forge (string separator collision) -------------------------------------
// Two DISTINCT arg lists that collide under a naive separator-join key:
//   f(p+SEP+"s:"+w, r) and f(p, w+SEP+"s:"+r) both flatten to  s:<p><SEP>s:<w><SEP>s:<r>.
function genKeyCollision(rnd) {
  const p = pick(rnd, ['a', 'xy', '', 'k']);
  const w = pick(rnd, ['b', 'q', '', 'm']);
  const r = pick(rnd, ['c', 'r', 'z', '']);
  const a1 = p + SEP + 's:' + w, b1 = r;
  const a2 = p,                  b2 = w + SEP + 's:' + r;
  return [
    'agent f(a, b){ report a }',
    `emit str(f(${q(a1)}, ${q(b1)}))`,
    `emit str(f(${q(a1)}, ${q(b1)}))`,
    `emit str(f(${q(a1)}, ${q(b1)}))`,   // promote + cache under the key
    `emit str(f(${q(a2)}, ${q(b2)}))`,   // distinct args, old-collision -> must NOT return the cached value
  ].join('\n');
}

// --- FAMILY: keyOf numeric collision (-0 vs 0) -----------------------------------------------------
// pow(x,-1) is sign-observable: pow(0,-1)=Infinity, pow(-0,-1)=-Infinity. String(-0)==="0", so a naive
// number tag keys -0 and 0 the same and a cached f(0) ghost-answers f(-0). Deterministically pair them.
function genNumeric(rnd) {
  const zeroFirst = rnd() < 0.5;
  const first = zeroFirst ? '0' : '(0-1)*0';        // (0-1)*0 evaluates to -0
  const second = zeroFirst ? '(0-1)*0' : '0';
  return [
    'agent f(x){ report pow(x, 0-1) }',
    `emit str(f(${first}))`,
    `emit str(f(${first}))`,
    `emit str(f(${first}))`,   // promote + cache under the numeric key
    `emit str(f(${second}))`,  // sign partner: a -0/0 key collision ghosts the cached answer
  ].join('\n');
}

// --- FAMILY: router-freeze -------------------------------------------------------------------------
// A pure agent wraps route() over two equally-good providers, driven with a constant arg. Sound runs
// share traffic (the wrapping agent must be tainted, not cached); a frozen run monopolizes one provider.
function genRouter(rnd) {
  const drives = rint(rnd, 20, 60);
  const arg = rint(rnd, 0, 3);
  return [
    'agent A(x){ report "A" }',
    'agent B(x){ report "B" }',
    'seed r = route("fz", [A, B])',
    'agent ask(q){ report r(q) }',
    'seed g = []',
    `reinforce ${drives} times { push(g, ask(${arg})) }`,
    'seed nA = count(g, agent(v){ report v == "A" })',   // count() promotes -> real cache hits
    'emit nA > 0, nA < ' + drives,                        // sound: both seen -> "live live"; frozen -> a "dead"
  ].join('\n');
}

// --- FAMILY: reap / epoch invalidation -------------------------------------------------------------
// f reads a FREE AGENT g (the recursion exemption keeps f pure, so it genuinely PROMOTES and caches).
// Then a dependency change must bump the epoch and drop f's stale cache: either g is rebound, or the
// mesh is metabolized. If epoch invalidation regresses, ON ghost-serves the old answer -> divergence.
function genReap(rnd) {
  const n1 = rint(rnd, 1, 9), n2 = rint(rnd, 10, 99), a = rint(rnd, 0, 3);
  const base = [
    `agent g(x){ report x + ${n1} }`,
    'agent f(x){ report g(x) }',
    `emit f(${a})`, `emit f(${a})`, `emit f(${a})`,   // promote + cache f(${a}) under the current g
  ];
  if (rnd() < 0.5) {
    // ghost-rebind: redefining g must invalidate f's cache (epoch bump)
    return base.concat([`agent g(x){ report x + ${n2} }`, `emit f(${a})`]).join('\n');
  }
  // ghost-reap: metabolize reaps the mesh; a sound epoch invalidates so f re-runs (and finds g reaped)
  return base.concat(['seed _ = metabolize(1000)', `attempt { emit f(${a}) } rescue e { emit "reaped" }`]).join('\n');
}

// --- FAMILY: broad nasty-arg coverage (pure agents, mixed types) -----------------------------------
function genNasty(rnd) {
  const arity = rint(rnd, 1, 3);
  const params = ['a', 'b', 'c'].slice(0, arity);
  const rep = pick(rnd, params);
  const nasty = ['', 'a', SEP, 's:', 'n:1', 'v', 'b:true', 'a' + SEP + 's:b', SEP + 's:', 's:' + SEP];
  const lit = () => {
    const k = rnd();
    if (k < 0.55) return q(pick(rnd, nasty));
    if (k < 0.8) return String(rint(rnd, -3, 3));            // small ints incl. negatives
    return pick(rnd, ['void', 'live', 'dead', '(0-1)*0']);   // incl. -0
  };
  const lines = [`agent f(${params.join(', ')}){ report ${rep} }`];
  const nCalls = rint(rnd, 4, 9);
  const pools = [];
  for (let i = 0; i < 3; i++) pools.push(params.map(lit).join(', '));   // repeated lists -> promotion
  for (let i = 0; i < nCalls; i++) {
    const args = rnd() < 0.55 ? pick(rnd, pools) : params.map(lit).join(', ');
    lines.push(`emit str(f(${args}))`);
  }
  return lines.join('\n');
}

const FAMILIES = [
  { name: 'keyCollision', gen: genKeyCollision, weight: 3 },
  { name: 'numeric',      gen: genNumeric,      weight: 2 },
  { name: 'router',       gen: genRouter,       weight: 3 },
  { name: 'reap',         gen: genReap,         weight: 2 },
  { name: 'nasty',        gen: genNasty,        weight: 2 },
];
const WEIGHTED = FAMILIES.flatMap((f) => Array(f.weight).fill(f));

// --- driver ----------------------------------------------------------------------------------------
// fuzz({ seed, count }) -> { checked, violations, byFamily, byFamilyHits }
//   byFamily     = programs generated per family
//   byFamilyHits = programs per family whose ON run reached >=1 real memo cache hit (hollow-family guard)
function fuzz({ seed = 0x1CE, count = 400 } = {}) {
  const rnd = makeRng(seed);
  const violations = [];
  const byFamily = Object.fromEntries(FAMILIES.map((f) => [f.name, 0]));
  const byFamilyHits = Object.fromEntries(FAMILIES.map((f) => [f.name, 0]));
  let checked = 0;
  for (let i = 0; i < count; i++) {
    const fam = pick(rnd, WEIGHTED);
    const src = fam.gen(rnd);
    checked++;
    byFamily[fam.name]++;
    const { violation, onHits } = differential(src);
    if (onHits > 0) byFamilyHits[fam.name]++;
    if (violation) violations.push({ family: fam.name, src, on: violation.on, off: violation.off });
  }
  return { checked, violations, byFamily, byFamilyHits };
}

module.exports = { fuzz, differential, runStats, makeRng };

// --- CLI: `node tools/memo-fuzz.js [seed] [count]` -------------------------------------------------
if (require.main === module) {
  const seed = process.argv[2] ? (parseInt(process.argv[2], 16) || parseInt(process.argv[2], 10)) : 0x1CE;
  const count = process.argv[3] ? parseInt(process.argv[3], 10) : 400;
  const { checked, violations, byFamily, byFamilyHits } = fuzz({ seed, count });
  console.log(`memo-soundness fuzz: seed=0x${seed.toString(16)} programs=${checked}`);
  console.log(`  generated : ${JSON.stringify(byFamily)}`);
  console.log(`  cache-hit : ${JSON.stringify(byFamilyHits)} (programs that reached >=1 real memo hit)`);
  if (!violations.length) {
    console.log(`RESULT: SOUND — memo-ON == memo-OFF on all ${checked} programs.`);
    process.exit(0);
  }
  console.log(`RESULT: ${violations.length} SOUNDNESS VIOLATION(S) — memo corrupted a result:`);
  for (const v of violations.slice(0, 5)) {
    console.log('\n--- family:', v.family, '---');
    console.log(v.src);
    console.log('  memo-ON :', JSON.stringify(v.on.ok ? v.on.v : 'THREW ' + v.on.v));
    console.log('  memo-OFF:', JSON.stringify(v.off.ok ? v.off.v : 'THREW ' + v.off.v));
  }
  if (violations.length > 5) console.log(`\n... and ${violations.length - 5} more.`);
  process.exit(1);
}
