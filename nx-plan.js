'use strict';
// nx-plan.js — the capability preview. Given a script, report what it is ALLOWED to touch (its `needs` manifest)
// versus what it actually TRIES to touch (capabilities it calls). This is the approval surface for handing Nx to
// an agent: a gate (or a human) can see a script's reach BEFORE running it, and catch fence mistakes statically —
//   • referenced-but-undeclared  -> the fence would DENY it at runtime (or, with no manifest, it runs ungoverned)
//   • declared-but-unreferenced  -> an over-grant to tighten
// Static + single-file: a "capability" is any called name that is neither a user `agent` nor a core builtin.
// Honest limit: names imported via `weave` aren't resolved, so an imported agent can look like a capability.

const fs = require('fs');
const path = require('path');
const { parse } = require('./parser');
const { builtins } = require('./builtins');

// Generic AST walk: visit every node (object with a string `type`), recursing through all properties.
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) walk(n, visit); return; }
  if (typeof node.type === 'string') visit(node);
  for (const k of Object.keys(node)) { if (k !== 'type') walk(node[k], visit); }
}

function calleeName(n) {
  if (!n) return null;
  if (n.type === 'Call' && n.callee && n.callee.type === 'Identifier') return n.callee.name;
  if (n.type === 'Pipe') return n.right && n.right.type === 'Call'
    ? (n.right.callee && n.right.callee.type === 'Identifier' ? n.right.callee.name : null)
    : (n.right && n.right.type === 'Identifier' ? n.right.name : null);   // `x | f`
  return null;
}

// The "safe core" in scope for every program: JS builtins + every agent the stdlib (std.nx) defines. We parse
// std.nx directly (NOT via makeInterpreter) to avoid a require cycle through nx.js — that's what makes the stdlib
// (`map`/`filter`/`sum`/…) not look like host capabilities.
let SAFE_CACHE = null;
function safeCore() {
  if (SAFE_CACHE) return SAFE_CACHE;
  const safe = new Set(Object.keys(builtins()));
  try {
    walk(parse(fs.readFileSync(path.join(__dirname, 'std.nx'), 'utf8')), (n) => { if (n.type === 'Agent') safe.add(n.name); });
  } catch { /* fall back to JS builtins only */ }
  SAFE_CACHE = safe;
  return safe;
}

// Names a pattern binds (so `match`/destructure binds shadow correctly and aren't seen as capabilities).
function patternBinds(pat, set) {
  if (!pat || typeof pat !== 'object') return;
  if (pat.type === 'PBind') set.add(pat.name);
  else if (pat.type === 'PList') { for (const e of pat.elements) patternBinds(e, set); if (pat.rest) set.add(pat.rest); }
  else if (pat.type === 'PMesh') { for (const pr of pat.pairs) patternBinds(pr.pattern, set); }
}

// Names DECLARED directly in a statement list (agents + seeds) — pre-collected so intra-scope references resolve
// regardless of order. A nested agent is NOT pulled up here; it only enters its enclosing scope, never the parent's.
function scopeDecls(stmts, set) {
  for (const s of stmts) {
    if (!s || typeof s !== 'object') continue;
    if (s.type === 'Agent') set.add(s.name);
    else if (s.type === 'Seed') set.add(s.name);
    else if (s.type === 'SeedDestructure') patternBinds(s.pattern, set);
  }
}

// Scope-aware capability detection with TWO resolution modes, mirroring the runtime (interpreter.js has NO hoisting):
//   • IMMEDIATE code (run in statement order) resolves only against decls seen SO FAR — so a call placed BEFORE a
//     same-named `agent` decl is NOT masked by it (closes the declaration-order decoy).
//   • DEFERRED bodies (an agent runs when CALLED, later) resolve against the FULL scope — so mutual recursion and
//     ordinary forward references still work.
// A called name not resolvable is a host capability.

// analyzeExpr: an expression runs immediately in `visible`; a deferred body (AgentExpr) sees the enclosing `full`
// scope (so forward refs resolve). `full` is threaded so the anon-agent path matches the named-agent path.
function analyzeExpr(node, visible, full, refs) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) analyzeExpr(n, visible, full, refs); return; }
  if (node.type === 'Call' || node.type === 'Pipe') {
    const name = calleeName(node);
    if (name && !visible.has(name) && !refs.has(name)) refs.set(name, node.line || 0);
    for (const k of Object.keys(node)) { if (k !== 'type') analyzeExpr(node[k], visible, full, refs); }
    return;
  }
  if (node.type === 'AgentExpr') {                 // DEFERRED body: sees the full enclosing scope + params (like a named agent)
    const child = new Set(full);
    for (const p of node.params) { child.add(p.name); if (p.def) analyzeExpr(p.def, child, full, refs); }
    analyzeBody(node.body, child, refs);
    return;
  }
  for (const k of Object.keys(node)) { if (k !== 'type') analyzeExpr(node[k], visible, full, refs); }
}

// analyzeBody: a statement list. `running` grows as decls are seen (for immediate code); `full` = parent + ALL of
// this scope's decls (for deferred agent bodies / forward refs).
function analyzeBody(stmts, parentVisible, refs) {
  const full = new Set(parentVisible); scopeDecls(stmts, full);
  const running = new Set(parentVisible);
  for (const s of stmts) {
    analyzeStmt(s, running, full, refs);
    if (s.type === 'Agent') running.add(s.name);
    else if (s.type === 'Seed') running.add(s.name);
    else if (s.type === 'SeedDestructure') patternBinds(s.pattern, running);
    else if (s.type === 'Take') running.add(s.name);
  }
}

function analyzeStmt(s, running, full, refs) {
  switch (s.type) {
    case 'Agent': {   // DEFERRED body: sees the full enclosing scope (forward refs OK) + its params
      const child = new Set(full);
      for (const p of s.params) { child.add(p.name); if (p.def) analyzeExpr(p.def, child, full, refs); }
      analyzeBody(s.body, child, refs);
      return;
    }
    // immediate blocks: run in order; their own bodies resolve against `running` (decls so far) + block-local binds
    case 'When':
      analyzeExpr(s.cond, running, full, refs);
      analyzeBody(s.thenBlock, running, refs);
      if (s.elseBlock) analyzeBody(s.elseBlock, running, refs);
      return;
    case 'Reinforce': analyzeExpr(s.cond, running, full, refs); analyzeBody(s.body, running, refs); return;
    case 'ReinforceTimes': analyzeExpr(s.count, running, full, refs); analyzeBody(s.body, running, refs); return;
    case 'ForEach': { analyzeExpr(s.iterable, running, full, refs); analyzeBody(s.body, addAll(running, [s.varName]), refs); return; }
    case 'Match': {
      analyzeExpr(s.subject, running, full, refs);
      for (const arm of s.arms) { const c = new Set(running); patternBinds(arm.pattern, c); analyzeBody(arm.body, c, refs); }
      return;
    }
    case 'Attempt':
      analyzeBody(s.tryBlock, running, refs);
      analyzeBody(s.catchBlock, addAll(running, [s.errName]), refs);
      return;
    case 'Test': analyzeBody(s.body, running, refs); return;
    default:
      analyzeExpr(s, running, full, refs);   // seed/emit/report/assign/decay/give/take/expression-statement -> immediate
      return;
  }
}

function addAll(set, names) { const c = new Set(set); for (const n of names) c.add(n); return c; }

// planScript(src) -> { needs:[{name,limit}], referenced:[{name,line,declared}], undeclared:[name], unused:[name], hasManifest }
function planScript(src) {
  const ast = parse(src);
  const needs = [];
  walk(ast, (n) => { if (n.type === 'Needs') for (const it of n.items) needs.push(it); });
  const declared = new Set(needs.map(x => x.name));

  const refs = new Map();      // host-capability name -> first line
  analyzeBody(ast.body, safeCore(), refs);

  const referenced = [...refs.entries()]
    .map(([name, line]) => ({ name, line, declared: declared.has(name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const undeclared = referenced.filter(r => !r.declared).map(r => r.name);
  const referencedSet = new Set(referenced.map(r => r.name));
  const unused = [...declared].filter(n => !referencedSet.has(n)).sort();
  return { needs, referenced, undeclared, unused, hasManifest: needs.length > 0 };
}

function fmtLimit(limit) {
  if (!limit) return '';
  const parts = [];
  if (limit.max != null) parts.push(`max ${limit.max}`);
  if (limit.total != null) parts.push(`total ${limit.total}`);
  return parts.length ? `  (${parts.join(', ')})` : '';
}

// A readable report. Returns { text, ok } — ok=false means the script would be refused at runtime (undeclared use).
function formatPlan(plan, file) {
  const L = [];
  L.push(`nx plan: ${file || '(script)'}`);
  L.push('');
  L.push('Declared capabilities (needs):');
  if (plan.needs.length === 0) L.push('  (none)');
  else for (const it of plan.needs) L.push(`  ${it.name}${fmtLimit(it.limit)}`);
  L.push('');
  L.push('Capabilities referenced in code:');
  if (plan.referenced.length === 0) L.push('  (none — this script reaches for nothing outside the language)');
  else for (const r of plan.referenced) {
    L.push(`  ${r.name}${' '.repeat(Math.max(1, 16 - r.name.length))}${r.declared ? 'OK declared' : 'XX NOT declared (line ' + r.line + ') — the fence would deny it'}`);
  }
  if (plan.unused.length) {
    L.push('');
    L.push('Over-grants (declared but never used — tighten these):');
    for (const n of plan.unused) L.push(`  ${n}`);
  }
  L.push('');
  let ok = true;
  if (plan.undeclared.length) {
    L.push(`VERDICT: ${plan.undeclared.length} referenced capability(ies) not declared — this script would be REFUSED at runtime (or run UNGOVERNED if the host requires no manifest).`);
    ok = false;
  } else if (!plan.hasManifest && plan.referenced.length) {
    L.push('VERDICT: no `needs` manifest, but capabilities are referenced — they would run UNGOVERNED unless the host requires a manifest. Declare a `needs` to bound them.');
    ok = false;
  } else {
    L.push('VERDICT: no undeclared capability reach detected (best-effort static preview). The runtime fence is the actual boundary.');
  }
  return { text: L.join('\n') + FOOTER, ok };
}

// Honest about what this is: a BEST-EFFORT static preview, NOT a sound security gate. The RUNTIME fence is what
// actually stops a capability call — `nx plan` is a lint to SEE a script's likely reach and catch common mistakes.
// It cannot soundly resolve capability vs. user-agent names statically (that needs whole-program flow analysis),
// so the disclosed blind spots below can hide a real reach. Always back it with the fence; never approve on it alone.
const FOOTER = '\n\n(Best-effort static preview, NOT the boundary — the RUNTIME FENCE enforces. It can be fooled by: a user agent that SHARES A NAME with a host capability (it masks the capability here, but the fence still resolves by execution order); a capability passed as a VALUE then invoked elsewhere (aliased to a variable, or handed to a higher-order function like sort/map/route/schedule); a name pulled in via weave; or a host capability registered under a core-builtin name. Use it to see intent and catch mistakes — never approve on it alone.)';

module.exports = { planScript, formatPlan, walk };
