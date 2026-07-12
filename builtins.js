'use strict';
// builtins.js — native functions written in JavaScript and exposed to Myxo.
// This is the host bridge: registerNative() is how the Nexus later hands real
// capabilities (db, telegram, wallet) to Myxo scripts. The safe core lives here.

const { VOID, stringify, typeName } = require('./interpreter');
const { MyxoError } = require('./errors');
const { performance } = require('perf_hooks');   // monotonic, sub-ms clock for the routing speed signal

function need(args, n, name) {
  if (args.length < n) throw new MyxoError(`${name} needs ${n} argument(s), got ${args.length}`);
}
function num(v, name) {
  if (typeof v !== 'number') throw new MyxoError(`${name} expected a number, got ${typeName(v)}`);
  return v;
}

// ---- automatic flow-routing: the SLIME MOLD. Providers are interchangeable ways to do one job; traffic flows
// to the working, FASTER path (shorter path -> stronger tube); a failure decays the tube hard and fails over;
// every tube passively decays each routing decision; faded tubes are periodically re-probed so a recovered one
// can climb back. Convergence + automatic failover + adaptation, learned from success/failure, no manual policy.
// PHYSARUM FLUX. Conductance = each tube's RECENT QUALITY (an EWMA of per-call success+speed), NOT cumulative
// volume — so a slow incumbent serving 95% of traffic can't out-mass a faster challenger, and a recovered/faster
// tube genuinely RE-BALANCES the route. Traffic is proportional to conductance via deterministic weighted
// round-robin (credits), with a minimum exploratory flux per tube so alternatives are always sampled (a failed
// tube triggers a switch; a clearly-better one climbs and takes over). On a call: each tube accrues credit
// (>= its conductance, floored to the explore share); the top-credit tube is served and pays `total` back; on
// success its conductance EWMAs toward the call's quality (fast -> high), on failure toward 0 (+ fail over). A
// fence/policy denial PROPAGATES — the slime mold must not route around the law. Constants are hand-tuned; this
// is exploit-leaning (it concentrates on the best tube), not a load balancer for equally-good providers.
const ALPHA = 0.3;       // how fast conductance tracks recent quality
const EXPLORE = 0.06;    // minimum exploratory flux share per tube
function routeCall(interp, name, callArgs) {
  const R = interp.routes.get(name);
  const n = R.providers.length;
  const total = R.cond.reduce((a, b) => a + b, 0) || 1;
  for (let i = 0; i < n; i++) R.credit[i] += Math.max(R.cond[i], EXPLORE * total);  // flux ∝ conductance, with a floor so faded/recovered tubes still get probed
  const order = R.credit.map((_, i) => i).sort((x, y) => R.credit[y] - R.credit[x]);
  let lastErr = null;
  for (const i of order) {
    R.credit[i] -= total;                            // this tube spent a turn (traffic rotates proportionally)
    const t0 = performance.now();
    try {
      const r = interp.callValue(R.providers[i], callArgs, 0);
      const quality = 1 + 8 / (performance.now() - t0 + 1);   // recent quality: success + speed (fast ~9, slow ~1)
      R.cond[i] = Math.max(0.05, (1 - ALPHA) * R.cond[i] + ALPHA * quality);  // EWMA toward recent quality
      return r;
    } catch (e) {
      if (e && e.nxFence) throw e;                   // policy denial: do NOT route around the law
      R.cond[i] = Math.max(0.05, (1 - ALPHA) * R.cond[i]);    // failure: quality 0 -> conductance falls; fail over
      lastErr = e;
    }
  }
  throw lastErr || new MyxoError(`route '${name}' has no working provider`);
}

// ---- THE PHYSARUM SCHEDULER. `route` picks ONE provider per call; `schedule` distributes a whole BATCH of work
// across a pool of interchangeable worker-agents, runs the chunks on real worker threads IN PARALLEL, measures
// each worker's throughput, and feeds that back into the SAME conductance law (EWMA of speed) — so over calls the
// pool LEARNS its own speed profile: fast workers pull more flux, slow/failed ones decay and get routed around.
// This is the living mesh applied to EXECUTION, not memory: the language becomes the scheduler.
//
// distribute(cond, m, credit): assign m work items to len(cond) workers, flux ∝ conductance, via the same
// credit-based weighted round-robin + explore floor as routeCall. The `credit` array is PERSISTED on the pool
// and carried across calls (like routeCall's own credit) — so a non-leading worker accrues credit over
// successive batches and is eventually sampled at a rate ∝ its conductance, and a recovered/faster tube climbs
// back. Without persistence the floor only guarantees sampling WITHIN one large batch (small batches starve the
// trailers); persisting it makes the "recovered worker climbs back" promise true in the small-batch regime too.
function distribute(cond, m, credit) {
  const n = cond.length;
  const total = cond.reduce((a, b) => a + b, 0) || 1;
  if (!credit) credit = cond.map(() => 0);              // a one-off round (failover) gets fresh credit; the main pool passes its own
  const assign = new Array(m);
  for (let k = 0; k < m; k++) {
    for (let i = 0; i < n; i++) credit[i] += Math.max(cond[i], EXPLORE * total);
    let best = 0;
    for (let i = 1; i < n; i++) if (credit[i] > credit[best]) best = i;
    credit[best] -= total;
    assign[k] = best;
  }
  return assign;
}

function scheduleRun(interp, name, workers, items) {
  if (typeof name !== 'string') throw new MyxoError('schedule(name, workers, items) needs a name string');
  if (!Array.isArray(workers) || workers.length === 0) throw new MyxoError('schedule needs a non-empty list of worker agents');
  if (!workers.every(w => w && w.__agent)) throw new MyxoError('schedule workers must all be agents (each takes a chunk list, returns a results list)');
  if (!Array.isArray(items)) throw new MyxoError('schedule needs a list of work items');

  let P = interp.pools.get(name);
  if (P) {
    if (P.workers.length !== workers.length || P.workers.some((w, i) => w !== workers[i]))
      throw new MyxoError(`scheduler '${name}' is already defined with different workers`);   // no silent stale pool
  } else {
    P = { workers: workers.slice(), cond: workers.map(() => 1), credit: workers.map(() => 0) };
    interp.pools.set(name, P);
  }

  const m = items.length;
  if (m === 0) return [];
  const { runSettled, assertSerializable } = require('./myxo-concurrent');
  const { nxToJs, jsToNx } = require('./polyglot');
  items.forEach((it) => { try { assertSerializable(it, 'a scheduled work item'); } catch (e) { throw new MyxoError(e.message); } });

  const results = new Array(m);

  // Run one parallel round: distribute `idxs` (global item indices) across the workers named by `workerIdxs`,
  // dispatch each non-empty chunk to its worker thread, update conductance from measured speed, fill `results`.
  // Returns the workers that FAILED (so the caller can reroute their items — the slime mold's failover).
  const runRound = (idxs, workerIdxs, credit) => {
    const assign = distribute(workerIdxs.map(wi => P.cond[wi]), idxs.length, credit);
    const chunks = workerIdxs.map(() => []);
    assign.forEach((local, k) => chunks[local].push(idxs[k]));

    const tasks = [], meta = [];
    chunks.forEach((chunkIdx, local) => {
      if (chunkIdx.length === 0) return;                       // a worker that drew no flux this round just isn't run
      const w = P.workers[workerIdxs[local]];
      tasks.push({ name: w.name, params: w.params, body: w.body, args: [chunkIdx.map(gi => nxToJs(items[gi]))] });
      meta.push({ wi: workerIdxs[local], chunkIdx });
    });

    const outcomes = runSettled(tasks);                       // real parallelism; throws only on the wall-clock timeout
    const failed = [];
    outcomes.forEach((o, t) => {
      const { wi, chunkIdx } = meta[t];
      if (o.ok) {
        const out = o.value;
        if (!Array.isArray(out) || out.length !== chunkIdx.length)
          throw new MyxoError(`scheduler '${name}': worker '${P.workers[wi].name || '?'}' returned ${Array.isArray(out) ? out.length + ' results' : 'a non-list'} for a ${chunkIdx.length}-item chunk — a worker must return one result per item, in order`);
        chunkIdx.forEach((gi, p) => { results[gi] = jsToNx(out[p]); });
        const quality = 1 + 8 / ((o.ms || 0) / chunkIdx.length + 1);   // per-item speed -> recent quality (fast ~9, slow ~1)
        P.cond[wi] = Math.max(0.05, (1 - ALPHA) * P.cond[wi] + ALPHA * quality);   // EWMA toward it: fast workers climb
      } else {
        P.cond[wi] = Math.max(0.05, (1 - ALPHA) * P.cond[wi]);   // a failed worker's tube decays toward 0
        failed.push({ wi, chunkIdx, error: o.error });
      }
    });
    return failed;
  };

  const allW = P.workers.map((_, i) => i);
  const failed = runRound(items.map((_, i) => i), allW, P.credit);   // round 1: all workers, with the pool's PERSISTENT credit

  // Failover (one round): reroute the failed workers' items to the survivors. The slime mold routes around damage.
  if (failed.length) {
    const dead = new Set(failed.map(f => f.wi));
    const survivors = allW.filter(i => !dead.has(i));
    if (survivors.length === 0) throw new MyxoError(`scheduler '${name}': every worker failed (${failed[0].error})`);
    const reroute = failed.flatMap(f => f.chunkIdx);
    const stillFailed = runRound(reroute, survivors);
    if (stillFailed.length) throw new MyxoError(`scheduler '${name}': ${stillFailed[0].error}`);
  }
  return results;
}

// Returns a plain object of name -> native fn. install() wires them in.
function builtins() {
  return {
    // — sizes & types —
    len: (a) => {
      const v = a[0];
      if (typeof v === 'string' || Array.isArray(v)) return v.length;
      if (v instanceof Map) return v.size;
      throw new MyxoError(`len expected a string, list, or mesh, got ${typeName(v)}`);
    },
    type: (a) => typeName(a[0]),

    // — mesh helpers —
    keys: (a) => { if (!(a[0] instanceof Map)) throw new MyxoError('keys expected a mesh'); return [...a[0].keys()]; },
    values: (a) => { if (!(a[0] instanceof Map)) throw new MyxoError('values expected a mesh'); return [...a[0].values()]; },
    has: (a) => { need(a, 2, 'has'); return a[0] instanceof Map ? a[0].has(String(a[1])) : false; },

    // — lists —
    range: (a) => {
      need(a, 1, 'range');
      const start = a.length > 1 ? num(a[0], 'range') : 0;
      const end = a.length > 1 ? num(a[1], 'range') : num(a[0], 'range');
      const out = [];
      for (let i = start; i < end; i++) out.push(i);
      return out;
    },
    push: (a) => { need(a, 2, 'push'); if (!Array.isArray(a[0])) throw new MyxoError('push expected a list'); a[0].push(a[1]); return a[0]; },
    pop: (a) => { if (!Array.isArray(a[0])) throw new MyxoError('pop expected a list'); return a[0].length ? a[0].pop() : VOID; },

    // — conversion & strings —
    str: (a) => stringify(a[0]),
    num: (a) => {
      const v = a[0];
      if (typeof v === 'number') return v;
      const n = parseFloat(v);
      if (Number.isNaN(n)) throw new MyxoError(`cannot read '${stringify(v)}' as a number`);
      return n;
    },
    upper: (a) => String(a[0]).toUpperCase(),
    lower: (a) => String(a[0]).toLowerCase(),

    // — math —
    abs: (a) => Math.abs(num(a[0], 'abs')),
    floor: (a) => Math.floor(num(a[0], 'floor')),
    ceil: (a) => Math.ceil(num(a[0], 'ceil')),
    sqrt: (a) => Math.sqrt(num(a[0], 'sqrt')),
    max: (a) => { need(a, 1, 'max'); return Math.max(...a.map(x => num(x, 'max'))); },
    min: (a) => { need(a, 1, 'min'); return Math.min(...a.map(x => num(x, 'min'))); },
    pow: (a) => { need(a, 2, 'pow'); return Math.pow(num(a[0], 'pow'), num(a[1], 'pow')); },
    log: (a) => { need(a, 1, 'log'); const x = num(a[0], 'log'); return a.length > 1 ? Math.log(x) / Math.log(num(a[1], 'log')) : Math.log(x); },
    sin: (a) => Math.sin(num(a[0], 'sin')),
    cos: (a) => Math.cos(num(a[0], 'cos')),
    tan: (a) => Math.tan(num(a[0], 'tan')),
    round: (a) => { need(a, 1, 'round'); const x = num(a[0], 'round'); const f = Math.pow(10, a.length > 1 ? num(a[1], 'round') : 0); return Math.round(x * f) / f; },
    random: (a) => {
      if (a.length === 0) return Math.random();
      if (a.length === 1) return Math.floor(Math.random() * num(a[0], 'random'));
      const lo = num(a[0], 'random'), hi = num(a[1], 'random');
      return lo + Math.random() * (hi - lo);
    },

    // — strings —
    split: (a) => { need(a, 2, 'split'); return String(a[0]).split(stringify(a[1])); },
    join: (a) => { need(a, 2, 'join'); if (!Array.isArray(a[0])) throw new MyxoError('join expected a list'); return a[0].map(x => stringify(x)).join(stringify(a[1])); },
    trim: (a) => String(a[0]).trim(),
    replace: (a) => { need(a, 3, 'replace'); return String(a[0]).split(stringify(a[1])).join(stringify(a[2])); },
    repeat: (a) => { need(a, 2, 'repeat'); return String(a[0]).repeat(Math.max(0, num(a[1], 'repeat'))); },
    chars: (a) => [...String(a[0])],
    starts: (a) => { need(a, 2, 'starts'); return String(a[0]).startsWith(stringify(a[1])); },
    ends: (a) => { need(a, 2, 'ends'); return String(a[0]).endsWith(stringify(a[1])); },

    // — generic sequence ops (string OR list) —
    slice: (a) => {
      need(a, 2, 'slice'); const s = a[0];
      if (typeof s !== 'string' && !Array.isArray(s)) throw new MyxoError(`slice expected a string or list, got ${typeName(s)}`);
      const end = a.length > 2 ? num(a[2], 'slice') : s.length;
      return s.slice(num(a[1], 'slice'), end);
    },
    find: (a, interp) => {
      need(a, 2, 'find'); const s = a[0];
      if (typeof s === 'string') return s.indexOf(stringify(a[1]));
      if (Array.isArray(s)) { for (let i = 0; i < s.length; i++) if (interp.equals(s[i], a[1])) return i; return -1; }
      throw new MyxoError(`find expected a string or list, got ${typeName(s)}`);
    },
    reverse: (a) => {
      const s = a[0];
      if (typeof s === 'string') return [...s].reverse().join('');
      if (Array.isArray(s)) return s.slice().reverse();
      throw new MyxoError(`reverse expected a string or list, got ${typeName(s)}`);
    },

    // — list mutation & mesh ops —
    shift: (a) => { if (!Array.isArray(a[0])) throw new MyxoError('shift expected a list'); return a[0].length ? a[0].shift() : VOID; },
    unshift: (a) => { need(a, 2, 'unshift'); if (!Array.isArray(a[0])) throw new MyxoError('unshift expected a list'); a[0].unshift(a[1]); return a[0]; },
    sort: (a, interp) => {
      if (!Array.isArray(a[0])) throw new MyxoError('sort expected a list');
      const xs = a[0].slice();
      const cmp = a[1];
      if (cmp && (cmp.__agent || cmp.__native)) xs.sort((p, q) => num(interp.callValue(cmp, [p, q]), 'sort comparator'));
      else xs.sort((p, q) => (typeof p === 'number' && typeof q === 'number') ? p - q : stringify(p) < stringify(q) ? -1 : stringify(p) > stringify(q) ? 1 : 0);
      return xs;
    },
    entries: (a) => { if (!(a[0] instanceof Map)) throw new MyxoError('entries expected a mesh'); return [...a[0].entries()].map(([k, v]) => [k, v]); },
    merge: (a) => { need(a, 2, 'merge'); if (!(a[0] instanceof Map) || !(a[1] instanceof Map)) throw new MyxoError('merge expected two meshes'); return new Map([...a[0], ...a[1]]); },

    // — the Law engine: introspect and prune the living mesh —
    mesh: (_a, interp) => {
      const m = new Map();
      for (const row of interp.meshSnapshot()) m.set(row.name, row.strength);
      return m;
    },
    prune: (a, interp) => {
      const threshold = a.length ? num(a[0], 'prune') : 1;
      let removed = 0;
      for (const [name, e] of [...interp.globals.vars]) {
        if (!e.system && e.strength < threshold) { interp.globals.vars.delete(name); removed++; }
      }
      if (removed) interp.epoch++;   // reaping a global pathway IS a global write -> invalidate memo caches (parity with `decay`); else a memoized caller keeps ghost-serving a reaped dependency
      return removed;
    },
    // — the living mesh: introspect heat, and metabolize (decay cold + report promoted) —
    strength: (a, interp) => {
      const name = a[0];
      if (typeof name !== 'string') throw new MyxoError('strength(name) needs a string pathway name');
      const e = interp.globals.vars.get(name);
      return e ? e.strength : 0;     // 0 = pathway absent or never read
    },
    metabolize: (a, interp) => {
      const threshold = a.length ? num(a[0], 'metabolize') : 2;
      const reaped = [];
      for (const [name, e] of [...interp.globals.vars]) {
        if (!e.system && e.strength < threshold) { interp.globals.vars.delete(name); reaped.push(name); }  // cold decays
      }
      if (reaped.length) interp.epoch++;   // same as prune: a reaped pathway invalidates every memo cache that could depend on it
      let promoted = 0;
      for (const rec of interp.memo.values()) if (rec.cache.size > 0) promoted++;   // hot pure agents that promoted
      const m = new Map();
      m.set('reaped', reaped);
      m.set('count', reaped.length);
      m.set('promoted', promoted);
      return m;
    },
    // — automatic flow-routing (the slime mold): route(name, [providers]) -> a router; flows(name) -> conductivities —
    route: (a, interp) => {
      const name = a[0], providers = a[1];
      if (typeof name !== 'string') throw new MyxoError('route(name, [providers]) needs a name string');
      if (!Array.isArray(providers) || providers.length === 0) throw new MyxoError('route needs a non-empty list of providers');
      if (!providers.every(p => p && (p.__agent || p.__native))) throw new MyxoError('route providers must all be agents');
      const existing = interp.routes.get(name);
      if (existing) {
        if (existing.providers.length !== providers.length || existing.providers.some((p, i) => p !== providers[i]))
          throw new MyxoError(`route '${name}' is already defined with different providers`);   // no silent stale providers
      } else {
        interp.routes.set(name, { providers: providers.slice(), cond: providers.map(() => 1), credit: providers.map(() => 0) });
      }
      const rname = name;
      // `impure: true` -> calling a router TAINTS the caller (like random/flows): a router is stateful (conductance
      // EWMA) and nondeterministic (weighted pick), so a plain agent that only calls it must NEVER be memoized —
      // otherwise the first answer freezes in the cache and the whole Physarum routing law dies inside a pure caller.
      return { __native: true, name: 'route:' + name, capability: false, impure: true, fn: (callArgs, ip) => routeCall(ip, rname, callArgs) };
    },
    flows: (a, interp) => {
      const name = a[0];
      const m = new Map();
      const R = interp.routes.get(name) || interp.pools.get(name);   // one viewer for both routers and scheduler pools
      if (!R) return m;
      const nodes = R.providers || R.workers;
      nodes.forEach((p, i) => {
        let key = p.name || ('p' + i);
        if (m.has(key)) key = key + '#' + i;   // disambiguate duplicate names so none is lost from view
        m.set(key, Math.round(R.cond[i] * 100) / 100);
      });
      return m;
    },
    // — the Physarum scheduler: distribute a batch across a learning pool of worker-agents, in parallel —
    schedule: (a, interp) => scheduleRun(interp, a[0], a[1], a[2]),

    // — cooperative concurrency: channels + the fiber scheduler —
    channel: (a) => {
      let cap = Infinity;
      if (a.length) {
        cap = num(a[0], 'channel');
        if (!Number.isInteger(cap) || cap < 1) throw new MyxoError('channel(capacity) needs a positive whole number');
      }
      return { __channel: true, buf: [], cap, recvW: [], sendW: [] };
    },
    drain: (a, interp) => { interp.pump(); interp.checkAllFibersDone(); return VOID; },   // run ALL fibers to completion
    await: (a, interp) => {                                       // run the scheduler, then resolve THIS fiber (not the whole pool)
      const f = a[0];
      if (!(f && f.__fiber)) throw new MyxoError(`await needs a fiber (from spawn), got ${typeName(f)}`);
      interp.pump();
      if (f.error) throw f.error;
      if (f.done) return f.result;
      throw new MyxoError('the awaited fiber is deadlocked — blocked with no one to unblock it');   // only blame f, not unrelated parked fibers
    },
  };
}

// Wire every builtin into an interpreter as a system native.
function install(interp) {
  const table = builtins();
  for (const [name, fn] of Object.entries(table)) interp.registerNative(name, fn);
}

module.exports = { builtins, install };
