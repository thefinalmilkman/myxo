'use strict';
// interpreter.js — walks the AST and makes it happen.
// Holds the Environment (where the Nexus law lives) and the host bridge.

const { MyxoError, NxAssertError } = require('./errors');

// The single void value. Anything missing or unreported is this.
const VOID = Symbol('void');

// `report` unwinds an agent call by throwing this.
class ReportSignal { constructor(value) { this.value = value; } }

// Structural equality for `expect ... is ...` — numbers/strings/bools/void by value,
// lists element-wise, meshes by key/value; agents/natives by identity.
function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (a instanceof Map && b instanceof Map) {
    if (a.size !== b.size) return false;
    for (const [k, v] of a) if (!b.has(k) || !deepEqual(v, b.get(k))) return false;
    return true;
  }
  return false;
}

// Type-tagged value renderer for assertion messages, so `1` vs `"1"` and `void`/`live`
// are distinguishable — a test runner's diagnostics must never read like a bug.
function showv(v) {
  if (typeof v === 'string') return JSON.stringify(v);
  if (v === VOID) return 'void';
  if (v === true) return 'live';
  if (v === false) return 'dead';
  return stringify(v);
}

// Gradual types: does a value satisfy a type annotation? `any` always does. Enforced only in strict mode.
function typeMatches(type, v) {
  switch (type) {
    case 'any': return true;
    case 'number': return typeof v === 'number';
    case 'string': return typeof v === 'string';
    case 'bool': return typeof v === 'boolean';
    case 'list': return Array.isArray(v);
    case 'mesh': return v instanceof Map;
    case 'agent': return !!(v && (v.__agent || v.__native));
    case 'void': return v === VOID;
    default: return true;
  }
}

// A pathway is a named binding carrying a strength. Reading it reinforces it
// (strength++). Decaying removes it. `system` marks builtins/std so they don't
// clutter the mesh view. Scopes chain through `parent` for lexical lookup.
class Environment {
  constructor(parent = null) { this.vars = new Map(); this.parent = parent; }

  define(name, value, system = false, type = null) { this.vars.set(name, { value, strength: 1, system, type }); }

  lookup(name) {                       // resolve WITHOUT reinforcing -> { entry, env } or null
    for (let env = this; env; env = env.parent) {
      const e = env.vars.get(name);
      if (e) return { entry: e, env };
    }
    return null;
  }

  get(name, line) {
    const f = this.lookup(name);
    if (!f) throw new MyxoError(`unknown pathway '${name}'`, line);
    f.entry.strength++; // useful pathways reinforce
    return f.entry.value;
  }

  set(name, value, line) {
    for (let env = this; env; env = env.parent) {
      if (env.vars.has(name)) { env.vars.get(name).value = value; return; }
    }
    throw new MyxoError(`cannot assign to unknown pathway '${name}' — seed it first`, line);
  }

  remove(name, line) {
    for (let env = this; env; env = env.parent) {
      if (env.vars.has(name)) { env.vars.delete(name); return; }
    }
    throw new MyxoError(`cannot decay unknown pathway '${name}'`, line);
  }
}

// ---- value helpers --------------------------------------------------------

function typeName(v) {
  if (v === VOID) return 'void';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'string') return 'string';
  if (typeof v === 'boolean') return 'bool';
  if (Array.isArray(v)) return 'list';
  if (v instanceof Map) return 'mesh';
  if (v && v.__agent) return 'agent';
  if (v && v.__native) return 'agent';
  if (v && v.__channel) return 'channel';
  if (v && v.__fiber) return 'fiber';
  return 'unknown';
}

// a value safe to use as a memo key / cached result (immutable, compares by value)
function isPrimitive(v) { return v === VOID || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean'; }

// builtins that read live mutable state or are nondeterministic/side-effecting -> a caller of them is NOT pure
const IMPURE_BUILTINS = new Set(['random', 'prune', 'metabolize', 'mesh', 'strength', 'schedule', 'flows', 'channel', 'drain', 'await', 'route']);

// a type-tagged, collision-free memo key (VOID / NaN / Infinity stay distinct — JSON.stringify collapses them to null)
function keyOf(args) {
  return args.map(a => {
    if (a === VOID) return 'v';
    const t = typeof a;
    if (t === 'number') return Number.isNaN(a) ? 'n:NaN' : a === Infinity ? 'n:Inf' : a === -Infinity ? 'n:-Inf' : 'n:' + a;
    if (t === 'boolean') return 'b:' + a;
    return 's:' + a;
  }).join('\x1f');
}

function truthy(v) {
  if (v === VOID) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof Map) return v.size > 0;
  return true; // agents/natives are always live
}

// Render a value as text. `quoted` adds quotes to strings inside collections.
function stringify(v, quoted = false) {
  if (v === VOID) return 'void';
  if (typeof v === 'boolean') return v ? 'live' : 'dead';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return quoted ? `"${v}"` : v;
  if (Array.isArray(v)) return '[' + v.map(e => stringify(e, true)).join(', ') + ']';
  if (v instanceof Map) {
    return '{' + [...v.entries()].map(([k, val]) => `${k}: ${stringify(val, true)}`).join(', ') + '}';
  }
  if (v && v.__agent) return `<agent ${v.name || 'anon'}>`;
  if (v && v.__native) return `<native ${v.name}>`;
  if (v && v.__channel) return `<channel${v.cap === Infinity ? '' : ' cap ' + v.cap}>`;
  if (v && v.__fiber) return `<fiber ${v.name || 'anon'}>`;
  return String(v);
}

// ---- the interpreter ------------------------------------------------------

class Interpreter {
  constructor(opts = {}) {
    this.globals = new Environment();
    this.output = opts.output || (s => process.stdout.write(s));
    this.baseDir = opts.dir || '.';
    this.moduleLoader = null;          // host grants this; without it, `weave` is fenced
    this.moduleCache = new Map();
    this.moduleInProgress = new Set();
    this.exportStack = [];
    this.dirStack = [];
    this.manifest = null;              // null = no `needs` declared
    this.requireManifest = !!opts.requireManifest; // production hosts can require `needs` before any capability call
    this.audit = [];                   // a ledger of every host-capability call
    this.callStack = [];               // live agent frames, for honest stack traces
    this.maxDepth = opts.maxDepth || 500;  // runaway-recursion backstop (well under the JS stack)
    this.maxSteps = Number.isFinite(opts.maxSteps) && opts.maxSteps > 0 ? opts.maxSteps : Infinity; // fuel for runaway loops
    this.steps = 0;
    this.capSpent = new Map();         // cumulative numeric arg-0 per VALUE-metered capability
    this.capCalls = new Map();         // cumulative CALL COUNT per capability (the default metering)
    this.valueCaps = new Set(opts.valueCaps || []);  // caps the HOST meters by value (e.g. spend); everything else = count.
                                       // The metering kind is host-fixed, NOT chooseable by the (untrusted) script's manifest.
    this.frames = [];                  // per-agent-call purity frames — the living mesh tracks taint here
    this.memo = new Map();             // agent -> { calls, impure, hits, cache } — hot-promotion (memoization)
    this.promoteAt = opts.promoteAt || 2;  // calls before a provably-pure agent's pathway promotes (memoizes)
    this.epoch = 0;                    // bumped on ANY global write — invalidates memo caches that could depend on it
    this.routes = new Map();           // name -> { providers, cond[], credit[] } — automatic flow-routing (the slime mold)
    this.pools = new Map();            // name -> { workers, cond[] } — the Physarum scheduler (flow-routing lifted to parallel batches)
    this.fibers = [];                  // all spawned fibers (for drain/deadlock detection) — cooperative concurrency
    this.ready = [];                   // the cooperative scheduler's run queue: { fiber, val? }
    this.strict = !!opts.strict;       // `--strict` enforces gradual-type annotations as runtime contracts
    this.testMode = !!opts.testMode;   // `myxo test` flips this on; otherwise `test` blocks are inert
    this.testResults = [];             // collected { name, ok, error } from test blocks
    this.inTest = null;                // the active test record while a test body runs
  }

  // Install a native (host) function callable from Myxo. The bridge to the Nexus.
  registerNative(name, fn, capability = false, meter = 'count') {
    if (meter === 'value') this.valueCaps.add(name);   // host declares this cap is metered by value, not call-count
    this.globals.define(name, { __native: true, name, fn, capability }, true);
  }

  run(ast) {
    this.dirStack.push(this.baseDir);
    this.exportStack.push(new Set());
    try {
      let result = VOID;
      try {
        for (const stmt of ast.body) this.exec(stmt, this.globals);
      } catch (e) {
        if (e instanceof ReportSignal) result = e.value;   // top-level report ends the body...
        else throw e;
      }
      // ...but spawned fibers ALWAYS run to completion at program end, on EITHER exit path, and their held errors
      // and deadlocks ALWAYS surface — a background fiber's failure must never vanish silently. (`if fibers.length`
      // not `if some-not-done`: an errored fiber is marked done, so checking !done would let its error fall through.)
      if (this.fibers.length) { this.pump(); this.checkAllFibersDone(); }
      return result;
    } catch (e) {
      // never let a raw JS stack overflow reach the user — make it Myxo's own error.
      if (e instanceof RangeError && /call stack/i.test(e.message)) {
        throw new MyxoError('call stack went too deep — runaway recursion?');
      }
      throw e;
    } finally {
      this.dirStack.pop();
      this.exportStack.pop();
    }
  }

  execBlock(stmts, env) { for (const s of stmts) this.exec(s, env); }

  step(line) {
    if (this.maxSteps === Infinity) return;
    this.steps++;
    if (this.steps > this.maxSteps) {
      throw new MyxoError(`execution fuel exhausted after ${this.maxSteps} steps`, line);
    }
  }

  // ---- statements ---------------------------------------------------------

  exec(node, env) {
    this.step(node.line);
    switch (node.type) {
      case 'Seed': {
        const sv = this.eval(node.value, env);
        if (this.strict && node.declType && !typeMatches(node.declType, sv))
          throw new MyxoError(`'${node.name}' expects ${node.declType}, got ${typeName(sv)}`, node.line);
        if (env === this.globals && env.vars.has(node.name)) this.epoch++;  // redefining a global -> invalidate dependent caches
        env.define(node.name, sv, false, node.declType);   // carry the type so a later reassignment is also contract-checked
        return;
      }
      case 'SeedDestructure': {
        const value = this.eval(node.value, env);
        const binds = this.matchPattern(node.pattern, value, env);
        if (!binds) throw new MyxoError('destructuring pattern did not match the value', node.line);
        if (env === this.globals) this.epoch++;   // global binding(s) changed -> invalidate dependent caches
        for (const k of Object.keys(binds)) env.define(k, binds[k]);
        return;
      }
      case 'Assign': return this.execAssign(node, env);
      case 'Decay': return this.execDecay(node, env);
      case 'Emit': {
        const text = node.args.map(a => stringify(this.eval(a, env))).join(' ');
        if (this.frames.length) this.markImpure();   // output is an observable side effect -> never memoize it away
        this.output(text + '\n');
        return;
      }
      case 'When': {
        if (truthy(this.eval(node.cond, env))) this.execBlock(node.thenBlock, new Environment(env));
        else if (node.elseBlock) this.execBlock(node.elseBlock, new Environment(env));
        return;
      }
      case 'Reinforce':
        while (truthy(this.eval(node.cond, env))) this.execBlock(node.body, new Environment(env));
        return;
      case 'ReinforceTimes': {
        const n = this.eval(node.count, env);
        if (typeof n !== 'number') throw new MyxoError(`reinforce ... times needs a number, got ${typeName(n)}`, node.line);
        for (let k = 0; k < n; k++) this.execBlock(node.body, new Environment(env));
        return;
      }
      case 'ForEach': return this.execForEach(node, env);
      case 'Give': case 'Take': case 'Yield': {
        // Suspension points only mean something while a fiber is being stepped. Reaching the synchronous path means
        // either we're outside a fiber entirely, or we're inside one but on a non-suspendable sub-path (a CALLED
        // agent's body / an expression) — the scheduler can't suspend across that boundary. Be honest about which.
        const kw = node.type.toLowerCase();
        throw new MyxoError(this.steppingFiber
          ? `'${kw}' can't be used inside a called agent — only in the fiber's own body (and inside when/match/for each/reinforce/attempt)`
          : `'${kw}' is only valid inside a spawned fiber`, node.line);
      }
      case 'Agent':
        if (env === this.globals && env.vars.has(node.name)) this.epoch++;  // redefining a global agent -> invalidate (stale free-callee reads)
        env.define(node.name, { __agent: true, name: node.name, params: node.params, body: node.body, closure: env, returnType: node.returnType });
        return;
      case 'Report':
        throw new ReportSignal(this.eval(node.value, env));
      case 'Attempt': {
        try { this.execBlock(node.tryBlock, new Environment(env)); }
        catch (e) {
          if (e instanceof ReportSignal) throw e;   // `report` still unwinds
          if (!(e instanceof MyxoError)) throw e;      // real JS bugs propagate
          const m = new Map();
          m.set('message', e.message);
          m.set('line', typeof e.line === 'number' ? e.line : VOID);
          m.set('value', e.nxValue !== undefined ? e.nxValue : VOID);
          const child = new Environment(env);
          child.define(node.errName, m);
          this.execBlock(node.catchBlock, child);
        }
        return;
      }
      case 'Fail': {
        const v = this.eval(node.value, env);
        const err = new MyxoError(typeof v === 'string' ? v : stringify(v), node.line);
        err.nxFail = true;
        err.nxValue = v;
        throw err;
      }
      case 'Weave': {
        if (this.frames.length) this.markImpure();   // module load can have side effects -> taint the calling agent
        const p = this.eval(node.path, env);
        if (typeof p !== 'string') throw new MyxoError(`weave needs a string path, got ${typeName(p)}`, node.line);
        const exports = this.weaveModule(p, node.line);
        if (node.alias) env.define(node.alias, new Map(exports));   // namespaced
        else for (const [k, v] of exports) env.define(k, v);        // flat
        return;
      }
      case 'Expose': {
        const top = this.exportStack[this.exportStack.length - 1];
        if (top) top.add(node.name);
        return;
      }
      case 'Needs': {
        if (!this.manifest) this.manifest = new Map();   // name -> limit | null
        for (const it of node.items) this.manifest.set(it.name, it.limit || null);
        return;
      }
      case 'Match': {
        const subject = this.eval(node.subject, env);
        for (const arm of node.arms) {
          const binds = this.matchPattern(arm.pattern, subject, env);
          if (binds) {
            const child = new Environment(env);
            for (const k of Object.keys(binds)) child.define(k, binds[k]);
            this.execBlock(arm.body, child);
            return;
          }
        }
        return;   // no arm matched -> nothing runs (use `_` for a catch-all)
      }
      case 'Test': {
        if (!this.testMode) return;   // test blocks are inert unless run via `myxo test`
        const rec = { name: node.name, ok: true, error: null, asserts: 0, line: node.line };
        const prev = this.inTest;
        this.inTest = rec;
        try {
          this.execBlock(node.body, new Environment(env));
          if (rec.asserts === 0) { rec.ok = false; rec.error = 'no expectations ran (empty test)'; }
        } catch (e) {
          if (e instanceof ReportSignal) { rec.ok = false; rec.error = "a test body cannot 'report' — it ends the test before its assertions"; }
          else if (e instanceof NxAssertError) { rec.ok = false; rec.error = e.message; }
          else if (e instanceof MyxoError) { rec.ok = false; rec.error = 'errored: ' + e.message; }
          else throw e;   // a real JS bug aborts the run
        } finally {
          this.inTest = prev;
        }
        this.testResults.push(rec);
        return;
      }
      case 'Expect': {
        if (!this.inTest) throw new MyxoError("'expect' is only valid inside a test block", node.line);
        this.inTest.asserts++;
        const m = node.matcher;
        if (m.kind === 'fail' || m.kind === 'failwith') {
          let threw = null;
          try { this.eval(node.actual, env); }
          catch (e) { if (e instanceof MyxoError) threw = e; else throw e; }   // report/JS-bug propagate
          if (!threw) throw new NxAssertError('expected the expression to fail, but it succeeded', node.line);
          // Only an INTENTIONAL failure satisfies `to fail`: an explicit `fail`, or a fence/budget denial.
          // An incidental error (unknown pathway, bad arity, type error) re-throws -> the test ERRORS, never
          // silently passes for the wrong reason. (Use the rescue form to assert an arbitrary runtime error.)
          if (!threw.nxFail && !threw.nxFence) throw threw;
          if (m.kind === 'failwith') {
            const want = this.eval(m.expected, env);
            if (typeof want !== 'string') throw new MyxoError("'to fail with' needs a string", node.line);
            if (!String(threw.message).includes(want))
              throw new NxAssertError(`expected failure containing ${showv(want)}, got ${showv(threw.message)}`, node.line);
          }
          return;
        }
        const actual = this.eval(node.actual, env);
        if (m.kind === 'truthy') {
          if (actual && (actual.__agent || actual.__native))
            throw new NxAssertError(`expected a value, but got ${showv(actual)} — did you forget to call it?`, node.line);
          if (!truthy(actual)) throw new NxAssertError(`expected a live value, got ${showv(actual)}`, node.line);
          return;
        }
        const expected = this.eval(m.expected, env);
        const eq = deepEqual(actual, expected);
        if (m.kind === 'is' && !eq) throw new NxAssertError(`expected ${showv(expected)}, got ${showv(actual)}`, node.line);
        if (m.kind === 'isnot' && eq) throw new NxAssertError(`expected not ${showv(expected)}, but got it`, node.line);
        return;
      }
      case 'ExpressionStatement':
        this.eval(node.expr, env);
        return;
      default:
        throw new MyxoError(`cannot execute ${node.type}`, node.line);
    }
  }

  // Try a pattern against a value. Returns a bindings object on match ({} = matched, no binds),
  // or null on no match. Used by `match`.
  matchPattern(pat, value, env) {
    switch (pat.type) {
      case 'PWild': return {};
      case 'PBind': return { [pat.name]: value };
      case 'PLit': return deepEqual(this.eval(pat.expr, env), value) ? {} : null;
      case 'PList': {
        if (!Array.isArray(value)) return null;
        const n = pat.elements.length;
        if (pat.rest == null ? value.length !== n : value.length < n) return null;
        const binds = {};
        for (let i = 0; i < n; i++) {
          const b = this.matchPattern(pat.elements[i], value[i], env);
          if (!b) return null;
          Object.assign(binds, b);
        }
        if (pat.rest != null) binds[pat.rest] = value.slice(n);
        return binds;
      }
      case 'PMesh': {
        if (!(value instanceof Map)) return null;
        const binds = {};
        for (const pr of pat.pairs) {
          if (!value.has(pr.key)) return null;
          const b = this.matchPattern(pr.pattern, value.get(pr.key), env);
          if (!b) return null;
          Object.assign(binds, b);
        }
        return binds;
      }
      default: throw new MyxoError(`unknown pattern type ${pat.type}`);
    }
  }

  execAssign(node, env) {
    const value = this.eval(node.value, env);
    const t = node.target;
    if (t.type === 'Identifier') {
      const f = env.lookup(t.name);
      const fr = this.frames.length ? this.frames[this.frames.length - 1] : null;
      if (fr && fr.pure && f && !this.isLocalEnv(f.env, fr.root)) this.markImpure();  // outer write taints the agent
      // global write, OR rebinding an agent value (a memoized caller may close over it via the recursion
      // exemption, and that read is taint-free) -> invalidate dependent caches. Agent rebinds are rare.
      if (f && (f.env === this.globals
          || (f.entry.value && (f.entry.value.__agent || f.entry.value.__native))
          || (value && (value.__agent || value.__native)))) this.epoch++;
      if (this.strict && f && f.entry.type && !typeMatches(f.entry.type, value))     // a typed binding stays typed on reassignment
        throw new MyxoError(`'${t.name}' expects ${f.entry.type}, got ${typeName(value)}`, node.line);
      env.set(t.name, value, t.line); return;
    }
    // Index target: list[i] = v  or  mesh[k] = v
    const obj = this.eval(t.object, env);
    const idx = this.eval(t.index, env);
    if (Array.isArray(obj)) {
      const i = this.asIndex(idx, obj.length, node.line, true);
      obj[i] = value;
    } else if (obj instanceof Map) {
      obj.set(this.asKey(idx, node.line), value);
    } else {
      throw new MyxoError(`cannot index a ${typeName(obj)}`, node.line);
    }
  }

  execDecay(node, env) {
    const t = node.target;
    if (t.type === 'Identifier') {
      const f = env.lookup(t.name);
      const fr = this.frames.length ? this.frames[this.frames.length - 1] : null;
      if (fr && fr.pure && f && !this.isLocalEnv(f.env, fr.root)) this.markImpure();  // outer decay taints the agent
      if (f && (f.env === this.globals
          || (f.entry.value && (f.entry.value.__agent || f.entry.value.__native)))) this.epoch++;  // global/agent decay -> invalidate
      env.remove(t.name, t.line); return;
    }
    const obj = this.eval(t.object, env);
    const idx = this.eval(t.index, env);
    if (Array.isArray(obj)) {
      const i = this.asIndex(idx, obj.length, node.line, false);
      obj.splice(i, 1);
    } else if (obj instanceof Map) {
      obj.delete(this.asKey(idx, node.line));
    } else {
      throw new MyxoError(`cannot decay a slot of ${typeName(obj)}`, node.line);
    }
  }

  execForEach(node, env) {
    const it = this.eval(node.iterable, env);
    let items;
    if (Array.isArray(it)) items = it.slice();
    else if (it instanceof Map) items = [...it.keys()];
    else if (typeof it === 'string') items = [...it];
    else throw new MyxoError(`cannot walk a ${typeName(it)} with 'for each'`, node.line);
    for (const item of items) {
      const child = new Environment(env);
      child.define(node.varName, item);
      this.execBlock(node.body, child);
    }
  }

  // ---- expressions --------------------------------------------------------

  eval(node, env) {
    this.step(node.line);
    switch (node.type) {
      case 'Number': return node.value;
      case 'String': return node.value;
      case 'Interp': return node.parts.map(p => stringify(this.eval(p, env))).join('');
      case 'Bool': return node.value;
      case 'Void': return VOID;
      case 'Identifier': {
        const f = env.lookup(node.name);
        if (!f) throw new MyxoError(`unknown pathway '${node.name}'`, node.line);
        f.entry.strength++;                                       // the law: reads reinforce
        const fr = this.frames.length ? this.frames[this.frames.length - 1] : null;
        if (fr && fr.pure && !f.entry.system && !this.isLocalEnv(f.env, fr.root)) {
          const val = f.entry.value;                              // reading mutable DATA from outside taints purity;
          if (!(val && (val.__agent || val.__native))) this.markImpure();  // reading code (agents/natives) is fine
        }
        return f.entry.value;
      }
      case 'List': return node.elements.map(e => this.eval(e, env));
      case 'Mesh': {
        const m = new Map();
        for (const [k, v] of node.pairs) m.set(this.asKey(this.eval(k, env), node.line), this.eval(v, env));
        return m;
      }
      case 'AgentExpr':
        return { __agent: true, name: 'anon', params: node.params, body: node.body, closure: env, returnType: node.returnType };
      case 'Unary': return this.evalUnary(node, env);
      case 'Binary': return this.evalBinary(node, env);
      case 'Index': return this.evalIndex(node, env);
      case 'Call': return this.evalCall(node, env);
      case 'Pipe': return this.evalPipe(node, env);
      case 'Dispatch': return this.evalDispatch(node, env);
      case 'Gather': return this.evalGather(node, env);
      case 'Spawn': return this.evalSpawn(node, env);
      default:
        throw new MyxoError(`cannot evaluate ${node.type}`, node.line);
    }
  }

  evalUnary(node, env) {
    const v = this.eval(node.operand, env);
    if (node.op === 'not') return !truthy(v);
    if (node.op === '-') {
      if (typeof v !== 'number') throw new MyxoError(`cannot negate a ${typeName(v)}`, node.line);
      return -v;
    }
  }

  evalBinary(node, env) {
    // Short-circuit logic.
    // Value-returning short-circuit: `a and b` -> b if a is live, else a;
    // `a or b` -> a if a is live, else b. Unlocks `x or default`.
    if (node.op === 'and') { const l = this.eval(node.left, env); return truthy(l) ? this.eval(node.right, env) : l; }
    if (node.op === 'or') { const l = this.eval(node.left, env); return truthy(l) ? l : this.eval(node.right, env); }

    const a = this.eval(node.left, env);
    const b = this.eval(node.right, env);
    switch (node.op) {
      case '==': return this.equals(a, b);
      case '!=': return !this.equals(a, b);
      case '+':
        if (typeof a === 'string' || typeof b === 'string') return stringify(a) + stringify(b);
        if (Array.isArray(a) && Array.isArray(b)) return a.concat(b);
        this.bothNumbers(a, b, node);
        return a + b;
      case '-': this.bothNumbers(a, b, node); return a - b;
      case '*': this.bothNumbers(a, b, node); return a * b;
      case '/': this.bothNumbers(a, b, node); if (b === 0) throw new MyxoError('division by zero', node.line); return a / b;
      case '%': this.bothNumbers(a, b, node); if (b === 0) throw new MyxoError('modulo by zero', node.line); return a % b;
      case '>': return this.compare(a, b, node) > 0;
      case '<': return this.compare(a, b, node) < 0;
      case '>=': return this.compare(a, b, node) >= 0;
      case '<=': return this.compare(a, b, node) <= 0;
      default: throw new MyxoError(`unknown operator ${node.op}`, node.line);
    }
  }

  evalIndex(node, env) {
    const obj = this.eval(node.object, env);
    const idx = this.eval(node.index, env);
    if (Array.isArray(obj)) {
      const i = this.asIndex(idx, obj.length, node.line, false);
      return obj[i];
    }
    if (obj instanceof Map) {
      const key = this.asKey(idx, node.line);
      return obj.has(key) ? obj.get(key) : VOID; // missing key is void, not an error
    }
    if (typeof obj === 'string') {
      const i = this.asIndex(idx, obj.length, node.line, false);
      return obj[i];
    }
    throw new MyxoError(`cannot index a ${typeName(obj)}`, node.line);
  }

  evalCall(node, env) {
    const callee = this.eval(node.callee, env);
    const args = node.args.map(a => this.eval(a, env));
    return this.callValue(callee, args, node.line);
  }

  // `x | f` -> f(x); `x | f(a, b)` -> f(x, a, b). The piped value is the FIRST argument.
  evalPipe(node, env) {
    const leftVal = this.eval(node.left, env);
    const r = node.right;
    if (r.type === 'Call') {
      const callee = this.eval(r.callee, env);
      const args = [leftVal, ...r.args.map(a => this.eval(a, env))];
      return this.callValue(callee, args, r.line);
    }
    return this.callValue(this.eval(r, env), [leftVal], node.line);
  }

  // `dispatch f(x)` builds an UNSTARTED task: it captures the agent's code + the evaluated args, but runs
  // nothing yet. The args must be plain data — a task crosses a thread boundary, where a closure can't follow.
  evalDispatch(node, env) {
    const agent = this.eval(node.call.callee, env);
    if (!(agent && agent.__agent)) throw new MyxoError('dispatch needs an agent, e.g. dispatch work(x)', node.line);
    const args = node.call.args.map(a => this.eval(a, env));
    const { assertSerializable } = require('./myxo-concurrent');
    args.forEach((a) => { try { assertSerializable(a, 'a dispatch argument'); } catch (e) { throw new MyxoError(e.message, node.line); } });
    return { __task: true, name: agent.name, params: agent.params, body: agent.body, args };
  }

  // `gather [t1, t2, ...]` runs every dispatched task on its own worker thread, in parallel, and blocks until
  // all finish — then returns their results in order. Each task runs ISOLATED (stdlib + its args + itself): it
  // cannot see or mutate the parent's pathways, which is exactly what makes parallel execution race-free.
  evalGather(node, env) {
    const list = this.eval(node.expr, env);
    if (!Array.isArray(list)) throw new MyxoError('gather expects a list of dispatched tasks', node.line);
    if (this.frames.length) this.markImpure();                 // spawning threads is an effect -> never memoize a gather away
    const { nxToJs, jsToNx } = require('./polyglot');
    const tasks = list.map((h, i) => {
      if (!(h && h.__task)) throw new MyxoError(`gather: item ${i} is not a dispatched task (use 'dispatch f(x)')`, node.line);
      return { name: h.name, params: h.params, body: h.body, args: h.args.map(a => nxToJs(a)) };
    });
    const { runParallel } = require('./myxo-concurrent');
    let raw;
    try { raw = runParallel(tasks); }
    catch (e) { throw new MyxoError('gather: ' + (e && e.message ? e.message : String(e)), node.line); }
    return raw.map(jsToNx);
  }

  // ---- cooperative concurrency: fibers + channels ----------------------------------------------------------
  // `spawn f(x)` starts a fiber: a lightweight task that runs COOPERATIVELY (interleaved on this one thread —
  // not in parallel; that's what `gather` is for). Fibers communicate through channels, parking when a channel
  // blocks so another fiber can run. No shared mutable state — the channel value passes hand to hand — so it's
  // race-free by construction, just like the law says. `drain()`/`join()` run the scheduler to completion.

  evalSpawn(node, env) {
    const agent = this.eval(node.call.callee, env);
    if (!(agent && agent.__agent)) throw new MyxoError('spawn needs an agent, e.g. spawn worker(ch)', node.line);
    const args = node.call.args.map(a => this.eval(a, env));
    if (this.frames.length) this.markImpure();                 // spawning a fiber is an effect -> never memoize it away
    return this.spawnFiber(agent, args, node.line);
  }

  spawnFiber(agent, args, line) {
    const params = agent.params;
    const hasRest = params.length > 0 && params[params.length - 1].rest;
    const required = params.filter(p => !p.rest && p.def == null).length;
    if (args.length < required) throw new MyxoError(`agent ${agent.name} needs at least ${required} argument(s), got ${args.length}`, line);
    if (!hasRest && args.length > params.length) throw new MyxoError(`agent ${agent.name} takes at most ${params.length} argument(s), got ${args.length}`, line);
    const local = new Environment(agent.closure);              // bind params exactly as callValue does
    let ai = 0;
    for (const p of params) {
      if (p.rest) { local.define(p.name, args.slice(ai)); ai = args.length; break; }
      if (ai < args.length) local.define(p.name, args[ai++], false, p.paramType);
      else local.define(p.name, p.def != null ? this.eval(p.def, local) : VOID, false, p.paramType);
    }
    if (this.strict) {
      for (const p of params) {
        if (p.paramType && !p.rest) {
          const pv = local.vars.get(p.name).value;
          if (!typeMatches(p.paramType, pv)) throw new MyxoError(`agent ${agent.name || 'anon'} param '${p.name}' expects ${p.paramType}, got ${typeName(pv)}`, line);
        }
      }
    }
    const fiber = { __fiber: true, name: agent.name || 'fiber', done: false, result: VOID, error: null };
    fiber.gen = this.stepBlock(agent.body, local);
    this.fibers.push(fiber);
    this.ready.push({ fiber });
    return fiber;
  }

  // The generator stepper: runs a fiber's STATEMENTS, yielding a park-request at each suspension point. Leaf
  // statements (and ALL expressions) run on the normal synchronous path — only the block-bearing statements and
  // the channel ops need to be generator-aware, so the rest of the interpreter is untouched.
  *stepBlock(stmts, env) {
    for (const s of stmts) yield* this.stepStmt(s, env);
  }

  *stepStmt(node, env) {
    this.step(node.line);
    switch (node.type) {
      case 'Give': {
        const ch = this.eval(node.channel, env);
        if (!(ch && ch.__channel)) throw new MyxoError(`give needs a channel, got ${typeName(ch)}`, node.line);
        const value = this.eval(node.value, env);
        if (ch.recvW.length) { this.ready.push({ fiber: ch.recvW.shift(), val: value }); }   // hand straight to a waiting receiver
        else if (ch.buf.length < ch.cap) { ch.buf.push(value); }                              // room to buffer
        else { yield { t: 'send', ch, value }; }                                              // bounded + full -> park (waker buffers it)
        return;
      }
      case 'Take': {
        const ch = this.eval(node.channel, env);
        if (!(ch && ch.__channel)) throw new MyxoError(`take needs a channel, got ${typeName(ch)}`, node.line);
        let value;
        if (ch.buf.length) {
          value = ch.buf.shift();
          if (ch.sendW.length) { const s = ch.sendW.shift(); ch.buf.push(s.value); this.ready.push({ fiber: s.fiber }); }  // freed a slot -> wake a blocked sender
        } else {
          value = yield { t: 'recv', ch };                                                    // empty -> park; resumed with the taken value
        }
        env.define(node.name, value);
        return;
      }
      case 'Yield': yield { t: 'yield' }; return;
      case 'When':
        if (truthy(this.eval(node.cond, env))) yield* this.stepBlock(node.thenBlock, new Environment(env));
        else if (node.elseBlock) yield* this.stepBlock(node.elseBlock, new Environment(env));
        return;
      case 'Reinforce':
        while (truthy(this.eval(node.cond, env))) yield* this.stepBlock(node.body, new Environment(env));
        return;
      case 'ReinforceTimes': {
        const n = this.eval(node.count, env);
        if (typeof n !== 'number') throw new MyxoError(`reinforce ... times needs a number, got ${typeName(n)}`, node.line);
        for (let k = 0; k < n; k++) yield* this.stepBlock(node.body, new Environment(env));
        return;
      }
      case 'ForEach': {
        const it = this.eval(node.iterable, env);
        let items;
        if (Array.isArray(it)) items = it.slice();
        else if (it instanceof Map) items = [...it.keys()];
        else if (typeof it === 'string') items = [...it];
        else throw new MyxoError(`cannot walk a ${typeName(it)} with 'for each'`, node.line);
        for (const item of items) {
          const child = new Environment(env);
          child.define(node.varName, item);
          yield* this.stepBlock(node.body, child);
        }
        return;
      }
      case 'Match': {   // generator-aware so a channel op inside an arm still suspends (mirrors exec's Match)
        const subject = this.eval(node.subject, env);
        for (const arm of node.arms) {
          const binds = this.matchPattern(arm.pattern, subject, env);
          if (binds) {
            const child = new Environment(env);
            for (const k of Object.keys(binds)) child.define(k, binds[k]);
            yield* this.stepBlock(arm.body, child);
            return;
          }
        }
        return;
      }
      case 'Attempt': {   // generator-aware so a channel op in the try/rescue suspends — NOT swallowed as a fake failure (mirrors exec's Attempt)
        try { yield* this.stepBlock(node.tryBlock, new Environment(env)); }
        catch (e) {
          if (e instanceof ReportSignal) throw e;
          if (!(e instanceof MyxoError)) throw e;
          const m = new Map();
          m.set('message', e.message);
          m.set('line', typeof e.line === 'number' ? e.line : VOID);
          m.set('value', e.nxValue !== undefined ? e.nxValue : VOID);
          const child = new Environment(env);
          child.define(node.errName, m);
          yield* this.stepBlock(node.catchBlock, child);
        }
        return;
      }
      default:
        this.exec(node, env);   // a non-suspending leaf runs synchronously; a channel op reached here (e.g. in a CALLED agent) hits exec's guard
        return;
    }
  }

  // pump(): run the ready queue until no fiber can make progress. Does NOT itself decide deadlock — the CALLER
  // does (drain/program-end want "everyone finished"; await wants only its target). Re-entrancy is forbidden:
  // calling drain/await from inside a fiber would re-enter here and miscount the in-flight fiber as deadlocked.
  pump() {
    if (this.inScheduler) {
      throw new MyxoError("the fiber scheduler is already running — 'await'/'drain' can't be called from inside a fiber (coordinate with channels or 'yield' instead)");
    }
    this.inScheduler = true;
    const cap = Number.isFinite(this.maxSteps) ? this.maxSteps : 10000000;   // bound a runaway (e.g. yield-forever) so it errors, never hangs
    let steps = 0;
    try {
      while (this.ready.length) {
        if (++steps > cap) throw new MyxoError('fiber scheduler exceeded its step budget (runaway fibers?)');
        const { fiber, val } = this.ready.shift();
        if (fiber.done) continue;
        let r;
        this.steppingFiber = true;                              // a channel op reaching exec's guard now knows it's inside a fiber (honest message)
        try { r = fiber.gen.next(val); }
        catch (e) {
          if (e instanceof ReportSignal) { fiber.done = true; fiber.result = e.value; continue; }
          fiber.done = true; fiber.error = e; continue;          // hold the error; the caller surfaces it
        } finally { this.steppingFiber = false; }
        if (r.done) { fiber.done = true; continue; }             // body fell off the end -> result stays void
        const sig = r.value;
        if (sig.t === 'yield') this.ready.push({ fiber });
        else if (sig.t === 'recv') sig.ch.recvW.push(fiber);
        else if (sig.t === 'send') sig.ch.sendW.push({ fiber, value: sig.value });
      }
    } finally { this.inScheduler = false; }
  }

  // After a full drain (drain()/program end), EVERYONE must have finished — surface the first error, then any deadlock.
  checkAllFibersDone() {
    const failed = this.fibers.find(f => f.error);
    if (failed) throw failed.error;
    const stuck = this.fibers.filter(f => !f.done);
    if (stuck.length) throw new MyxoError(`${stuck.length} fiber(s) deadlocked — blocked on a channel with no one to unblock them`);
  }

  callValue(callee, args, line) {
    if (callee && callee.__native) {
      if (!callee.capability) {
        if (IMPURE_BUILTINS.has(callee.name) || callee.impure) this.markImpure(); // nondeterministic / state-reading / global-mutating builtin (incl. routers) -> taint the caller
        return callee.fn(args, this);                        // a language builtin — free
      }
      this.markImpure();                                     // any host capability call taints purity (side effects)
      // a host capability: enforce the manifest, then record the call in the audit ledger.
      const refuse = (error, msg) => {
        this.audit.push({ cap: callee.name, args: args.map(a => stringify(a)), ok: false, error });
        const err = new MyxoError(msg, line);
        err.nxFence = true; throw err;   // a policy denial, not a transient failure — a router must NOT route around it
      };
      if (!this.manifest && this.requireManifest) {
        refuse('missing needs manifest',
          `script must declare a 'needs' manifest before calling capability '${callee.name}'`);
      }
      if (this.manifest && !this.manifest.has(callee.name)) {
        // overreach is logged too — you want to know an agent TRIED.
        refuse('not declared in needs',
          `capability '${callee.name}' is not declared in this script's 'needs'`);
      }
      // a declared `(max N)` / `(total N)` cap is the script's OWN ceiling — enforced here, so even a host that
      // grants unlimited power is bounded by what the script said it may do. CRUCIALLY, whether a cap is metered
      // by CALL COUNT or by VALUE is fixed by the HOST (valueCaps), never by the untrusted script — otherwise a
      // hostile script would declare a count cap as a value budget and pay 0 per call. Default = count.
      const limit = this.manifest ? this.manifest.get(callee.name) : null;
      const isValue = this.valueCaps.has(callee.name);
      if (limit) {
        if (isValue) {
          // VALUE metering: the first arg IS the amount. Must be a finite, non-negative number.
          const v = args[0];
          if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
            refuse('invalid value-budget argument',
              `capability '${callee.name}' has a value budget and needs a finite non-negative numeric first argument (got ${stringify(v)})`);
          }
          if (limit.max != null && v > limit.max) {
            refuse(`over the per-call max of ${limit.max}`,
              `capability '${callee.name}' exceeds its per-call max of ${limit.max} (got ${v})`);
          }
          if (limit.total != null) {
            const prior = this.capSpent.get(callee.name) || 0;
            if (prior + v > limit.total) {
              refuse(`over the total budget of ${limit.total}`,
                `capability '${callee.name}' would exceed its total value budget of ${limit.total} (${prior} already used)`);
            }
          }
        } else {
          // COUNT metering (default): every call costs exactly 1, whatever the arguments. Both `max` and `total`
          // bound the cumulative call count; the tighter one binds. The script CANNOT cheapen a call to 0.
          const cap = Math.min(limit.total != null ? limit.total : Infinity,
                               limit.max != null ? limit.max : Infinity);
          if (Number.isFinite(cap)) {
            const prior = this.capCalls.get(callee.name) || 0;
            if (prior + 1 > cap) {
              refuse(`over the call budget of ${cap}`,
                `capability '${callee.name}' would exceed its budget of ${cap} call(s) (${prior} already used)`);
            }
          }
        }
      }
      const entry = { cap: callee.name, args: args.map(a => stringify(a)) };
      try {
        const r = callee.fn(args, this);
        entry.ok = true; entry.result = stringify(r);
        if (limit) {
          if (isValue) this.capSpent.set(callee.name, (this.capSpent.get(callee.name) || 0) + args[0]);
          else this.capCalls.set(callee.name, (this.capCalls.get(callee.name) || 0) + 1);
        }
        this.audit.push(entry);
        return r;
      } catch (e) {
        // Compute the message DEFENSIVELY first — a native may `throw null` / `throw "str"` / `throw {}`,
        // and reading `.message` off a non-object would itself throw a TypeError that escapes rescue
        // (the gate's exact repro). Do this before touching the ledger so the audit entry always records.
        const msg = (e && e.message != null) ? String(e.message) : String(e);
        entry.ok = false; entry.error = msg;
        this.audit.push(entry);
        // A FAILING host capability must be rescuable in-script, exactly like a fence denial —
        // `attempt { lookup(x) } rescue e { ... }` is the documented pattern (§15 catches MyxoError only).
        // A raw JS error from the host (network refused, timeout, host bug) previously leaked through
        // attempt/rescue and killed the whole run — the lichen-sentry dogfood caught it: a DOWN brain
        // crashed the monitor instead of producing its ALERT verdict.
        if (e instanceof MyxoError) throw e;
        const wrapped = new MyxoError(`capability '${callee.name}' failed: ${msg}`, line);
        // PRESERVE policy flags: command-fence's policyError throws a PLAIN Error with nxFence=true (a
        // denial a flow-router must NOT route around) — and nxFail marks an intentional failure. Stripping
        // them would let a router bypass a policy refusal and would break `expect ... to fail`. Carry them.
        if (e && e.nxFence) wrapped.nxFence = true;
        if (e && e.nxFail) wrapped.nxFail = true;
        throw wrapped;
      }
    }
    if (callee && callee.__agent) {
      const params = callee.params;
      const hasRest = params.length > 0 && params[params.length - 1].rest;
      const required = params.filter(p => !p.rest && p.def == null).length;
      if (args.length < required) {
        throw new MyxoError(`agent ${callee.name} needs at least ${required} argument(s), got ${args.length}`, line);
      }
      if (!hasRest && args.length > params.length) {
        throw new MyxoError(`agent ${callee.name} takes at most ${params.length} argument(s), got ${args.length}`, line);
      }
      // --- THE LIVING MESH: a hot agent's pathway PROMOTES (memoizes) ONLY where the runtime can prove it safe. ---
      // SOUND conditions, all required: (a) plain params only -> args fully determine the call (no default-expr to track
      // or omit from the key); (b) the call was never tainted -> no capability / random / emit / weave / state-reading
      // builtin, no outer write, no free DATA read (reading a free AGENT is allowed, for recursion); (c) args AND result
      // are primitive; (d) the global EPOCH is unchanged -> any global write since caching invalidates. Any taint, ever,
      // permanently disables the agent. (Memoization is an optimization; it is NOT claimed invisible to mesh strengths.)
      const memoEligible = params.every(p => !p.rest && p.def == null);
      const argsPrim = memoEligible && args.every(isPrimitive);
      let rec = this.memo.get(callee);
      if (!rec) { rec = { calls: 0, impure: false, hits: 0, cache: new Map(), epoch: this.epoch }; this.memo.set(callee, rec); }
      rec.calls++;
      if (rec.epoch !== this.epoch) { rec.cache.clear(); rec.epoch = this.epoch; }   // a global changed -> drop possibly-stale entries
      if (argsPrim && !rec.impure && rec.calls > this.promoteAt) {
        const k = keyOf(args);
        if (rec.cache.has(k)) { rec.hits++; return rec.cache.get(k); }   // promoted pathway short-circuits
      }
      const local = new Environment(callee.closure);
      let ai = 0;
      for (const p of params) {
        if (p.rest) { local.define(p.name, args.slice(ai)); ai = args.length; break; }
        if (ai < args.length) local.define(p.name, args[ai++], false, p.paramType);
        else local.define(p.name, p.def != null ? this.eval(p.def, local) : VOID, false, p.paramType);  // default in call scope
      }
      if (this.strict) {   // gradual-type contracts on the parameters (read-only; never taints purity)
        for (const p of params) {
          if (p.paramType && !p.rest) {
            const pv = local.vars.get(p.name).value;
            if (!typeMatches(p.paramType, pv))
              throw new MyxoError(`agent ${callee.name || 'anon'} param '${p.name}' expects ${p.paramType}, got ${typeName(pv)}`, line);
          }
        }
      }
      if (this.callStack.length >= this.maxDepth) {
        throw new MyxoError(`call stack went too deep (over ${this.maxDepth}) — runaway recursion?`, line);
      }
      this.callStack.push({ name: callee.name || 'anon', line });
      const frame = { root: local, pure: true };
      this.frames.push(frame);
      let result = VOID, completed = false;
      try {
        this.execBlock(callee.body, local);
        completed = true;
      } catch (e) {
        if (e instanceof ReportSignal) { result = e.value; completed = true; }
        else {
          // stamp the trace at the deepest agent the failure passes through, while every outer frame is still live.
          if (e instanceof MyxoError && !e.nxStack) e.nxStack = this.callStack.slice();
          throw e;
        }
      } finally {
        this.callStack.pop();
        this.frames.pop();
        if (!frame.pure) { rec.impure = true; rec.cache.clear(); }   // taint sticks even if the call threw
      }
      // cache only a clean, hot, primitive-result call, at the current epoch
      if (this.strict && callee.returnType && !typeMatches(callee.returnType, result))
        throw new MyxoError(`agent ${callee.name || 'anon'} should return ${callee.returnType}, got ${typeName(result)}`, line);
      // cache only AFTER the return contract passes -> a violating result is never cached and every call errors
      if (completed && !rec.impure && argsPrim && isPrimitive(result) && rec.calls >= this.promoteAt && rec.cache.size < 50000) {
        rec.cache.set(keyOf(args), result);
      }
      return result;
    }
    throw new MyxoError(`${typeName(callee)} is not an agent — cannot call it`, line);
  }

  // ---- small typed helpers ------------------------------------------------

  bothNumbers(a, b, node) {
    if (typeof a !== 'number' || typeof b !== 'number') {
      throw new MyxoError(`'${node.op}' needs two numbers, got ${typeName(a)} and ${typeName(b)}`, node.line);
    }
  }

  compare(a, b, node) {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
    throw new MyxoError(`cannot compare ${typeName(a)} and ${typeName(b)}`, node.line);
  }

  equals(a, b) {
    if (a === VOID || b === VOID) return a === b;
    if (typeof a !== typeof b) return false;
    return a === b; // primitives by value; collections/agents by identity
  }

  asIndex(idx, length, line, allowAppend) {
    if (typeof idx !== 'number' || !Number.isInteger(idx)) {
      throw new MyxoError(`index must be a whole number, got ${typeName(idx)}`, line);
    }
    const i = idx < 0 ? length + idx : idx; // negative indexes from the end
    if (i < 0 || i > length || (!allowAppend && i >= length)) {
      throw new MyxoError(`index ${idx} is outside the list (length ${length})`, line);
    }
    return i;
  }

  asKey(idx, line) {
    if (typeof idx === 'string') return idx;
    if (typeof idx === 'number') return String(idx);
    throw new MyxoError(`mesh keys must be strings or numbers, got ${typeName(idx)}`, line);
  }

  // weave a strand: load its AST via the host loader, run it in its OWN scope,
  // and return a mesh of the names it `expose`d. Loading is a granted capability
  // (no loader -> weaving is fenced). Modules are cached; cycles are caught.
  weaveModule(reqPath, line) {
    if (!this.moduleLoader) throw new MyxoError(`weaving '${reqPath}' is not granted in this context`, line);
    const fromDir = this.dirStack[this.dirStack.length - 1] || this.baseDir;
    let loaded;
    try { loaded = this.moduleLoader(reqPath, fromDir); }
    catch (e) { throw new MyxoError(`cannot weave '${reqPath}': ${e.message}`, line); }
    if (this.moduleCache.has(loaded.key)) return this.moduleCache.get(loaded.key);
    if (this.moduleInProgress.has(loaded.key)) throw new MyxoError(`circular weave of '${reqPath}'`, line);
    this.moduleInProgress.add(loaded.key);
    const modEnv = new Environment(this.globals);
    const exportSet = new Set();
    this.exportStack.push(exportSet);
    this.dirStack.push(loaded.dir);
    try {
      this.execBlock(loaded.ast.body, modEnv);
    } finally {
      this.exportStack.pop();
      this.dirStack.pop();
      this.moduleInProgress.delete(loaded.key);
    }
    const exports = new Map();
    for (const name of exportSet) {
      if (!modEnv.vars.has(name)) throw new MyxoError(`'${name}' was exposed but never seeded in '${reqPath}'`, line);
      exports.set(name, modEnv.vars.get(name).value);
    }
    this.moduleCache.set(loaded.key, exports);
    return exports;
  }

  // a side-effect / free-read taints the current agent call AND every caller above it
  // (a caller's result depends on the tainted callee), so it can never be memoized.
  markImpure() { for (const f of this.frames) f.pure = false; }

  // is a resolved binding inside THIS call's own scope (local), or a free/outer var?
  isLocalEnv(foundEnv, root) {
    for (let a = root.parent; a; a = a.parent) if (a === foundEnv) return false; // resolved above the call root -> free
    return true;                                                                  // root itself or a descendant -> local
  }

  // A snapshot of the living mesh: user pathways and their strengths.
  meshSnapshot() {
    const rows = [];
    for (const [name, e] of this.globals.vars) if (!e.system) rows.push({ name, strength: e.strength });
    return rows.sort((x, y) => y.strength - x.strength);
  }
}

module.exports = { Interpreter, Environment, VOID, ReportSignal, stringify, truthy, typeName };
