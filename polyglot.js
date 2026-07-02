'use strict';
// polyglot.js — Nx as the connective layer for OTHER LANGUAGES. The keystone: an Nx capability is just
// `name -> fn`, so Nx neither knows nor cares what language is behind it; each runner is a FENCED native, so the
// one law governs every cross-language call. TWO tiers (honest — these are NOT one contract):
//   1. RICH bridge via `defineLang()` -> `Xcall(file,func,...args)` + `Xeval(expr)`, value-mapped (mesh/list/
//      number/bool round-trip, verified identical across languages) with structured returns. Needs a runtime
//      with an eval-a-string flag. BUILT + TESTED: Python (-c), Node (-e), Perl (-e); Ruby (-e) fits the shape.
//      Each harness is small but NOT trivial — it carries that language's module-load, hard-exit, JSON and eval
//      quirks; adding a language means getting those right, not just pasting a string.
//   2. WEAK bridge via `bridgeExec(cmd)` -> raw stdout string in/out, NO value mapping. This is the ONLY path
//      for COMPILED languages with no eval flag (Go, Rust, C++ binaries) and for CLIs; plus `sh` for the shell.
// Only Python/Node/Perl are installed + tested here; other languages are a forward design, not a present claim.
// Non-finite numbers (NaN/Infinity) are an EXPLICIT error on every path (never a silent null): args via toJson,
// Python via allow_nan=False, Node via a throwing replacer, Perl via parse. Anti-spoof hard-exit: Python os._exit
// and Perl POSIX::_exit are TRUE hard exits (skip atexit/END); Node process.exit runs 'exit' handlers, so a
// loaded module's exit-time stdout could (in trusted code) trail and, worst case, spoof the result.
//
// ⚠️  HONEST SECURITY MODEL — read before trusting this.  The fence bounds WHICH languages/verbs a script may
// reach (needs-manifest), HOW MANY / HOW MUCH (value budgets: numeric first-arg = spend; otherwise = call count),
// and LOGS every call (audit ledger). It does NOT sandbox the code that runs INSIDE a granted verb. `Xcall`/
// `Xeval`/`sh` are ARBITRARY-CODE capabilities: granting one grants the FULL power of that runtime (filesystem,
// network, subprocess). Use them only for code YOU trust. For untrusted / model-generated callers, expose only
// STRUCTURED capabilities (one specific function/tool), where the fence is meaningful end to end. Calls are
// synchronous (execFileSync, built on spawnSync); a persistent-worker fast path is a future plank. Note: Nx
// numbers are float64, so an integer above 2^53 returned from a language loses precision. Zero deps.
// Built 2026-06-26 (two-agent gated).

const { execFileSync, execSync } = require('child_process');
const { NxError } = require('./errors');
const { VOID } = require('./interpreter');

const CAP = 8 * 1024 * 1024, TIMEOUT = 15000;
const OK = String.fromCharCode(1), ERR = String.fromCharCode(2);   // result-framing markers (U+0001 / U+0002)

function detail(e) { const s = e.stderr && String(e.stderr).trim(); return s || e.message || (e.code ? String(e.code) : 'failed'); }

// ---- Nx <-> JS value mapping (mesh<->object, list<->array, VOID<->null), with a cycle guard ----
function nxToJs(v, seen) {
  if (v === VOID) return null;
  if (Array.isArray(v) || v instanceof Map) {
    seen = seen || new Set();
    if (seen.has(v)) throw new NxError('cannot send a cyclic value across the language bridge');
    seen.add(v);
    let out;
    if (Array.isArray(v)) out = v.map(x => nxToJs(x, seen));
    else { out = {}; for (const [k, val] of v) out[k] = nxToJs(val, seen); }
    seen.delete(v);   // pop on exit: only the ACTIVE path is "seen" -> shared (diamond) refs are fine; true cycles still caught
    return out;
  }
  return v;
}
// JSON for the wire, but a non-finite number is an explicit error (consistent across languages — never a silent null)
function toJson(v) {
  return JSON.stringify(v, (k, val) => {
    if (typeof val === 'number' && !isFinite(val)) throw new NxError('cannot send a non-finite number across the language bridge');
    return val;
  });
}
function jsToNx(v) {
  if (v === null || v === undefined) return VOID;
  if (Array.isArray(v)) return v.map(jsToNx);
  if (typeof v === 'object') { const m = new Map(); for (const k of Object.keys(v)) m.set(k, jsToNx(v[k])); return m; }
  return v;
}

// A harness writes its framed result then HARD-EXITS, so nothing (atexit/threads/shutdown noise) can write
// after it and spoof the marker. This parser is language-agnostic: U+0001 + JSON on success, U+0002 + msg on error.
function parseFramed(out, what) {
  const i = out.lastIndexOf(OK), j = out.lastIndexOf(ERR);
  if (j > i) throw new NxError(`${what} error: ` + out.slice(j + 1).trim());
  if (i < 0) throw new NxError(`${what} returned no result`);
  try { return jsToNx(JSON.parse(out.slice(i + 1))); }
  catch (e) { throw new NxError(`${what} returned a value Nx can't represent (non-finite or non-JSON): ` + e.message); }
}

function runHarness(cmd, flag, harness, extraArgs, label) {
  let out;
  try { out = execFileSync(cmd, [flag, harness, ...extraArgs], { encoding: 'utf8', timeout: TIMEOUT, maxBuffer: CAP }); }
  catch (e) { throw new NxError(`${label} failed: ` + detail(e)); }
  return parseFramed(out, label);
}

// defineLang — the heart: turn any language into fenced `Xcall(file, func, ...args)` + `Xeval(expr)` natives.
// `callHarness`/`evalHarness` are programs IN that language implementing the framing protocol above.
function defineLang({ name, cmd, flag, callHarness, evalHarness }) {
  const call = (args) => {
    const [file, func, ...rest] = args;
    if (typeof file !== 'string' || typeof func !== 'string') throw new NxError(`${name}call(file, func, ...args) needs file and func as strings`);
    return runHarness(cmd, flag, callHarness, [file, func, toJson(rest.map(a => nxToJs(a)))], name);
  };
  const evl = (args) => {
    if (typeof args[0] !== 'string') throw new NxError(`${name}eval(expr) needs a string`);
    return runHarness(cmd, flag, evalHarness, [args[0]], name);
  };
  return { call, eval: evl };
}

// ---- Python (python -c) — json.dumps(allow_nan=False): non-finite -> clean framed error; os._exit -> no trailing spoof
const PY = process.platform === 'win32' ? 'python' : 'python3';
const python = defineLang({
  name: 'python', cmd: PY, flag: '-c',
  callHarness: [
    'import sys, json, os, importlib.util',
    'p, fn, a = sys.argv[1], sys.argv[2], sys.argv[3]',
    'try:',
    '    spec = importlib.util.spec_from_file_location("nx_mod", p)',
    '    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    '    o = "\\u0001" + json.dumps(getattr(m, fn)(*json.loads(a)), allow_nan=False)',
    'except Exception as e:',
    '    o = "\\u0002" + str(e).replace("\\u0001", "").replace("\\u0002", "")',
    'sys.stdout.write(o); sys.stdout.flush(); os._exit(0)',
  ].join('\n'),
  evalHarness: [
    'import sys, json, os',
    'try: o = "\\u0001" + json.dumps(eval(sys.argv[1]), allow_nan=False)',
    'except Exception as e: o = "\\u0002" + str(e).replace("\\u0001", "").replace("\\u0002", "")',
    'sys.stdout.write(o); sys.stdout.flush(); os._exit(0)',
  ].join('\n'),
});

// ---- Node (node -e) — the .js file must be a CommonJS module exporting the function; fs.writeSync + process.exit
const node = defineLang({
  name: 'node', cmd: 'node', flag: '-e',
  callHarness: [
    "const p=require('path'),fs=require('fs');",
    "const J=x=>JSON.stringify(x,(k,v)=>{if(typeof v==='number'&&!isFinite(v))throw new Error('non-finite number');return v;});",
    "try{const m=require(p.resolve(process.argv[1]));",
    "let r=m[process.argv[2]](...JSON.parse(process.argv[3]));if(r===undefined)r=null;",
    "fs.writeSync(1,'\\u0001'+J(r));}",
    "catch(e){fs.writeSync(1,'\\u0002'+String(e&&e.message||e).replace(/[\\u0001\\u0002]/g,''));}process.exit(0);",
  ].join(''),
  evalHarness: [
    "const fs=require('fs');",
    "const J=x=>JSON.stringify(x,(k,v)=>{if(typeof v==='number'&&!isFinite(v))throw new Error('non-finite number');return v;});",
    "try{let r=(0,eval)(process.argv[1]);if(r===undefined)r=null;",
    "fs.writeSync(1,'\\u0001'+J(r));}",
    "catch(e){fs.writeSync(1,'\\u0002'+String(e&&e.message||e).replace(/[\\u0001\\u0002]/g,''));}process.exit(0);",
  ].join(''),
});

// ---- Perl (perl -e) — `do $file` loads subs; return a scalar or a ref (arrayref/hashref) for structured data
const perl = defineLang({
  name: 'perl', cmd: 'perl', flag: '-e',
  callHarness: [
    "use JSON::PP; use File::Spec; use POSIX; $|=1; my($f,$fn,$a)=@ARGV;",
    "my $j=JSON::PP->new->allow_nonref->canonical; my $abs=File::Spec->rel2abs($f);",   // '.' left @INC in modern perl -> absolutize
    "my $r=eval{ do $abs; die $@ if $@; no strict 'refs'; &{$fn}(@{$j->decode($a)}) };",
    "if($@){ my $m=$@; $m=~s/[\\x01\\x02]//g; print \"\\x02\".$m } else { print \"\\x01\".$j->encode($r) } POSIX::_exit(0);",
  ].join(' '),
  evalHarness: [
    "use JSON::PP; use POSIX; $|=1; my $j=JSON::PP->new->allow_nonref->canonical;",
    "my $r=eval $ARGV[0]; if($@){ my $m=$@; $m=~s/[\\x01\\x02]//g; print \"\\x02\".$m } else { print \"\\x01\".$j->encode($r) } POSIX::_exit(0);",
  ].join(' '),
});

const pycall = python.call, pyeval = python.eval;
const jscall = node.call, jseval = node.eval;
const plcall = perl.call, pleval = perl.eval;

// argv is strings: scalars stringify; structured values go as JSON (no silent flattening to "[object Object]")
function toArg(a) {
  if (a === VOID) return '';
  if (Array.isArray(a) || a instanceof Map) return JSON.stringify(nxToJs(a));
  return String(a);
}
// bridgeExec('/path/to/binary' [, fixedArgs]) -> an Nx native; how a compiled C++/Go/Rust binary or CLI plugs in
function bridgeExec(cmd, fixedArgs = []) {
  return function (args) {
    let out;
    try { out = execFileSync(cmd, [...fixedArgs, ...args.map(toArg)], { encoding: 'utf8', timeout: TIMEOUT, maxBuffer: CAP }); }
    catch (e) { throw new NxError(`exec '${cmd}' failed: ` + detail(e)); }
    return out.replace(/\r?\n$/, '');
  };
}
// sh(command) -> run a shell command line, return stdout. (Shell parsing: hand only trusted strings.)
function sh(args) {
  if (typeof args[0] !== 'string') throw new NxError('sh(command) needs a string');
  try { return execSync(args[0], { encoding: 'utf8', timeout: TIMEOUT, maxBuffer: CAP }).replace(/\r?\n$/, ''); }
  catch (e) { throw new NxError('shell failed: ' + detail(e)); }
}

// Convenience: wire the bridges into an interpreter as FENCED capabilities (still gated by `needs`).
function installPolyglot(interp, extra = {}) {
  const fns = { pycall, pyeval, jscall, jseval, plcall, pleval, sh };
  for (const [name, fn] of Object.entries({ ...fns, ...extra })) interp.registerNative(name, fn, true);
}

module.exports = {
  pycall, pyeval, jscall, jseval, plcall, pleval, sh, bridgeExec,
  defineLang, installPolyglot, nxToJs, jsToNx,
};
