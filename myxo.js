#!/usr/bin/env node
'use strict';
// myxo.js — the Myxo entry point. `node myxo.js --help` for the full CLI.
//   run a file: node myxo.js script.myx [--trace] [--strict]   ·   subcommands: run · fmt · test · lsp · repl
//   --version / --help   ·   no args = REPL
//   embed: require('./myxo').run(src, opts) / runTests(src, opts) — Myxo inside any Node host (the Nexus)

const fs = require('fs');
const path = require('path');
const { parse } = require('./parser');
const { Interpreter, VOID, stringify } = require('./interpreter');
const { install } = require('./builtins');
const { bridgeMcpTools } = require('./mcp-bridge');
const { MyxoError } = require('./errors');
const { formatSource } = require('./format');

let STD_CACHE = null;
function stdSource() {
  if (STD_CACHE == null) STD_CACHE = fs.readFileSync(path.join(__dirname, 'std.myx'), 'utf8');
  return STD_CACHE;
}

// Build an interpreter with builtins + the self-hosted standard library loaded.
// Everything loaded here is marked `system` so it stays out of the mesh view.
// Load + parse a strand from disk. This is the granted module capability — an
// embedded host can withhold it (moduleLoader: null) to fence `weave` entirely.
function fileLoader() {
  return (reqPath, fromDir) => {
    const resolved = path.resolve(fromDir || process.cwd(), reqPath);
    return { ast: parse(fs.readFileSync(resolved, 'utf8')), key: resolved, dir: path.dirname(resolved) };
  };
}

function makeInterpreter(opts = {}) {
  const interp = new Interpreter({
    output: opts.output,
    dir: opts.dir,
    maxDepth: opts.maxDepth,
    maxSteps: opts.maxSteps,
    promoteAt: opts.promoteAt,
    requireManifest: opts.requireManifest,
    valueCaps: opts.valueCaps,
    testMode: opts.testMode,
    strict: opts.strict,
  });
  const scriptMaxSteps = interp.maxSteps;
  interp.maxSteps = Infinity;
  interp.moduleLoader = opts.moduleLoader !== undefined ? opts.moduleLoader : fileLoader();
  install(interp);
  interp.run(parse(stdSource()));
  interp.maxSteps = scriptMaxSteps;
  interp.steps = 0; // stdlib boot cost should not spend the caller's script fuel.
  for (const e of interp.globals.vars.values()) e.system = true;
  if (opts.natives) for (const [name, fn] of Object.entries(opts.natives)) interp.registerNative(name, fn, true);
  if (opts.mcp) bridgeMcpTools(interp, opts.mcp);   // every MCP tool becomes a fenced capability
  return interp;
}

// Render the living mesh as a little bar chart of pathway strengths.
function formatMesh(interp) {
  const rows = interp.meshSnapshot();
  if (!rows.length) return '\n— mesh is silent —\n';
  let out = '\n— the mesh —\n';
  for (const r of rows) out += `  ${r.name.padEnd(14)} ${'█'.repeat(Math.min(r.strength, 24))} ${r.strength}\n`;
  return out;
}

// The embed API. Returns captured output (opts.capture) or the program's value.
function run(src, opts = {}) {
  const chunks = [];
  const output = opts.capture ? (s => chunks.push(s)) : (opts.output || (s => process.stdout.write(s)));
  const interp = makeInterpreter({
    output,
    natives: opts.natives,
    dir: opts.dir,
    moduleLoader: opts.moduleLoader,
    maxDepth: opts.maxDepth,
    maxSteps: opts.maxSteps,
    requireManifest: opts.requireManifest,
    valueCaps: opts.valueCaps,
    mcp: opts.mcp,
    promoteAt: opts.promoteAt,
    strict: opts.strict,
  });
  let result;
  try {
    result = interp.run(parse(src));
  } finally {
    if (opts.onAudit) opts.onAudit(interp.audit);   // hand over the ledger even on failure
  }
  if (opts.trace) output(formatMesh(interp));
  return opts.capture ? chunks.join('') : result;
}

// Run the `test` blocks in a source string. Returns { results, passed, failed }.
// Self-hosted: a .myx file tests itself in Myxo, with no node:test involved.
function runTests(src, opts = {}) {
  // tests run STRICT by default — type annotations are enforced where you most want them.
  const interp = makeInterpreter({ dir: opts.dir, output: opts.output, testMode: true, strict: opts.strict !== false, maxSteps: opts.maxSteps, maxDepth: opts.maxDepth });
  interp.run(parse(src));
  const results = interp.testResults;
  const passed = results.filter(r => r.ok).length;
  return { results, passed, failed: results.length - passed };
}

// ---- command line ---------------------------------------------------------

function runFile(file, trace, strict) {
  const src = fs.readFileSync(file, 'utf8');
  const interp = makeInterpreter({ dir: path.dirname(path.resolve(file)), strict });
  interp.run(parse(src));
  if (trace) process.stdout.write(formatMesh(interp));
}

// Is this source still mid-block — unbalanced braces or an open string? Lets the
// REPL gather multi-line definitions instead of choking on the first line.
function needsMore(src) {
  let depth = 0, inStr = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '#') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') depth--;
  }
  return depth > 0 || inStr;
}

function repl() {
  const readline = require('readline');
  const interp = makeInterpreter();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'myxo> ' });
  process.stdout.write(`Myxo ${require('./package.json').version} — the language of the Nexus. Its runtime is a living law.\n`);
  process.stdout.write('Multi-line aware; Ctrl+C to leave.\n');
  rl.prompt();
  let buffer = '';
  rl.on('line', (line) => {
    buffer += (buffer ? '\n' : '') + line;
    if (needsMore(buffer)) { rl.setPrompt('..> '); rl.prompt(); return; }   // keep gathering
    const src = buffer.trim();
    buffer = '';
    rl.setPrompt('myxo> ');
    if (src) {
      try {
        const ast = parse(src);
        // Echo the value of a lone expression, the way a REPL should.
        if (ast.body.length === 1 && ast.body[0].type === 'ExpressionStatement') {
          const v = interp.eval(ast.body[0].expr, interp.globals);
          if (v !== VOID) process.stdout.write(stringify(v) + '\n');
        } else {
          interp.run(ast);
        }
      } catch (e) {
        process.stdout.write((e instanceof MyxoError ? e.format() : `error: ${e.message}`) + '\n');
      }
    }
    rl.prompt();
  });
  rl.on('close', () => process.stdout.write('\nthe mesh rests.\n'));
}

function fmtFiles(argv) {
  const write = argv.includes('--write');
  const check = argv.includes('--check');
  const dropComments = argv.includes('--drop-comments');
  const bad = argv.find(a => a.startsWith('--') && !['--write', '--check', '--drop-comments'].includes(a));
  if (bad) usageError(`unknown flag '${bad}' for fmt — use --check / --write / --drop-comments`);
  const files = argv.filter(a => !a.startsWith('--'));
  if (!files.length) usageError('usage: myxo fmt <file...> [--check] [--write] [--drop-comments]');
  let dirty = false;
  for (const file of files) {
    let st;
    try { st = fs.statSync(file); } catch { throw new MyxoError(`no such file: ${file}`); }
    if (!st.isFile()) throw new MyxoError(`not a file: ${file}`);
    const src = fs.readFileSync(file, 'utf8');
    const formatted = formatSource(src, { dropComments });   // comments are preserved by default; --drop-comments strips them
    const changed = formatted !== src.replace(/\r\n/g, '\n');
    if (check) {
      if (changed) {
        dirty = true;
        process.stderr.write(`${file} is not formatted\n`);
      }
      continue;
    }
    if (write) {
      if (changed) fs.writeFileSync(file, formatted);
      continue;
    }
    process.stdout.write(formatted);
  }
  if (check && dirty) process.exit(1);
}

// `myxo test <file-or-dir...>` — run Myxo test files, print a report, exit non-zero on any failure.
function testFiles(argv) {
  const targets = argv.filter(a => !a.startsWith('--'));
  if (!targets.length) usageError('usage: myxo test <file-or-dir...>');
  const files = [];
  const collect = (p) => {
    if (!fs.existsSync(p)) throw new MyxoError(`no such path: ${p}`);
    const st = fs.statSync(p);
    if (st.isDirectory()) { for (const f of fs.readdirSync(p).sort()) collect(path.join(p, f)); }   // recursive
    else if (st.isFile() && p.endsWith('.myx')) files.push(p);                                        // a dir named *.myx is traversed, not read
  };
  for (const t of targets) collect(t);
  if (!files.length) throw new MyxoError('no .myx test files found');
  let pass = 0, fail = 0;
  for (const file of files) {
    process.stdout.write(`\n${file}\n`);
    let res;
    try {
      res = runTests(fs.readFileSync(file, 'utf8'), { dir: path.dirname(path.resolve(file)) });
    } catch (e) {
      process.stdout.write(`  FAIL  (load error) ${e.message}\n`);
      fail++; continue;
    }
    for (const r of res.results) {
      if (r.ok) process.stdout.write(`  ok    ${r.name}\n`);
      else process.stdout.write(`  FAIL  ${r.name}\n          ${r.error}\n`);
    }
    pass += res.passed; fail += res.failed;
  }
  process.stdout.write(`\n${pass} passed, ${fail} failed\n`);
  if (pass === 0 && fail === 0) { process.stdout.write('no tests ran — nothing was verified\n'); process.exit(1); }
  if (fail) process.exit(1);
}

const USAGE = `Myxo — the language of the Nexus.

Usage:
  myxo <file.myx> [--trace] [--strict]   run a program  (--trace prints the mesh; --strict enforces types)
  myxo run <file.myx> [--trace|--strict] run a program (explicit form)
  myxo test <file|dir...>               run Myxo test files (strict by default)
  myxo fmt <file...> [--check|--write|--drop-comments]   format source
  myxo lsp                              start the stdio language server
  myxo plan <file.myx>                   preview a script's capability reach (the fence approval surface)
  myxo repl                             start the REPL  (also: myxo with no args)
  myxo --version | -v                   print the version
  myxo --help    | -h                   print this help`;

function usageError(msg) { process.stderr.write(`myxo: ${msg}\n`); process.exit(2); }   // 2 = bad usage

function planFile(argv) {
  const bad = argv.find(a => a.startsWith('--'));
  if (bad) usageError(`unknown flag '${bad}' — try \`myxo plan <file.myx>\``);
  const files = argv.filter(a => !a.startsWith('--'));
  if (!files.length) usageError('myxo plan needs a file — try `myxo plan <file.myx>`');
  // exit codes a gate can branch on: 0 = clean, 1 = analyzed-but-not-clean (policy), 2 = couldn't analyze (IO/parse/usage).
  let st;
  try { st = fs.statSync(files[0]); }
  catch { process.stderr.write(`myxo: no such file: ${files[0]}\n`); process.exit(2); }
  if (!st.isFile()) { process.stderr.write(`myxo: not a file: ${files[0]}\n`); process.exit(2); }
  const { planScript, formatPlan } = require('./myxo-plan');
  let plan;
  try { plan = planScript(fs.readFileSync(files[0], 'utf8')); }
  catch (e) { process.stderr.write((e instanceof MyxoError ? e.format() : `myxo: ${e.message}`) + '\n'); process.exit(2); }  // parse/analysis failure != policy
  const { text, ok } = formatPlan(plan, files[0]);
  process.stdout.write(text + '\n');
  if (!ok) process.exit(1);   // a script that would be denied (or run ungoverned) is a non-clean plan
}

function main() {
  const argv = process.argv.slice(2);
  try {
    const cmd = argv[0];
    if (cmd === '--help' || cmd === '-h' || cmd === 'help') { process.stdout.write(USAGE + '\n'); return; }
    if (cmd === '--version' || cmd === '-v' || cmd === 'version') { process.stdout.write(require('./package.json').version + '\n'); return; }
    if (cmd === 'fmt') { fmtFiles(argv.slice(1)); return; }
    if (cmd === 'test') { testFiles(argv.slice(1)); return; }
    if (cmd === 'lsp') { require('./myxo-lsp').serve(); return; }
    if (cmd === 'plan') { planFile(argv.slice(1)); return; }
    if (cmd === 'repl' || argv.length === 0) { repl(); return; }
    const args = cmd === 'run' ? argv.slice(1) : argv;
    const badFlag = args.find(a => a.startsWith('--') && a !== '--trace' && a !== '--strict');
    if (badFlag) usageError(`unknown flag '${badFlag}' — try \`myxo --help\``);   // never silently drop a flag (e.g. a typo'd --strict)
    const files = args.filter(a => !a.startsWith('--'));
    if (!files.length) usageError('no input file — try `myxo --help`');
    let st;
    try { st = fs.statSync(files[0]); }
    catch { process.stderr.write(`myxo: no such file: ${files[0]} — try \`myxo --help\`\n`); process.exit(1); }
    if (!st.isFile()) { process.stderr.write(`myxo: not a file: ${files[0]}\n`); process.exit(1); }
    runFile(files[0], args.includes('--trace'), args.includes('--strict'));
  } catch (e) {
    process.stderr.write((e instanceof MyxoError ? e.format() : `myxo: ${e.message}`) + '\n');   // never leak a raw Node stack
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { run, makeInterpreter, runTests };
