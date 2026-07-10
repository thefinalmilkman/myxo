#!/usr/bin/env node
'use strict';
// Myxo eval harness (Phase 1). The instrument: does a model (or a reference solution) produce Myxo
// that PASSES each task's checks? Zero-cost by default (--ref uses reference solutions; --model ollama
// is a local free model; --model claude is the paid frontier tier, opt-in).
//
//   node run-evals.js               # --ref: run every task's reference solution (validates the golden set + harness)
//   node run-evals.js --model ollama   # local free baseline
//   node run-evals.js --model claude   # frontier tier (needs ANTHROPIC_API_KEY; costs)
//
// A task folder holds prompt.md + (check.myx  OR  expected.txt [+ host.js]) + solution.myx (the reference)
//   + optional `requires` (newline-separated tokens that MUST appear in the solution source — the construct gate).
// Type A (check.myx): solution + check are run via myxo.runTests; pass = all check expects pass.
// Type B (expected.txt): solution is run via myxo.run (host.js grants natives); pass = captured output matches
//   AND (if host.js exports expectAudit) the fence's audit ledger satisfies it.
//
// Hardened by the two-agent gate (2026-07-01): execution is fuel-bounded (no infinite-loop hang);
// fence tasks are scored on the AUDIT LEDGER, not just stdout (a hardcoded-emit cheat now FAILs);
// a model's own `test` blocks are stripped before Type A scoring (no false-FAIL from a sloppy self-test);
// the construct gate rejects solutions that skip a required keyword (match / dispatch+gather);
// parse-vs-runtime is classified by an actual parse attempt, not message keywords.
const fs = require('fs');
const path = require('path');
const myxo = require(path.join(__dirname, '..', 'myxo'));
const { parse } = require(path.join(__dirname, '..', 'parser'));

const ROOT = __dirname;
const TASKS_DIR = path.join(ROOT, 'tasks');
const RESULTS_DIR = path.join(ROOT, 'results');
const MAX_STEPS = 5_000_000;   // fuel: bounds a runaway loop so one bad solution can't hang the whole run

const readIf = p => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);
const norm = s => String(s).replace(/\r\n/g, '\n').trim();

// Parse-first classification: if the source doesn't parse, the failure is definitively a parse error.
// (The old keyword-regex mislabeled runtime type errors as 'parse' and vice-versa — see the gate.)
function parseError(src) {
  try { parse(src); return null; } catch (e) { return String((e && e.message) || e); }
}

// Strip the model's OWN `test "..." { ... }` blocks before Type A scoring, so a sloppy self-test can't
// fail a task whose official checks all pass. String/comment-aware brace matching (same lexer-lite rules
// as the REPL's needsMore; an interpolation with a nested string is a rare edge, tolerated).
function stripTests(src) {
  let out = '', i = 0;
  const n = src.length;
  const atWord = (kw, at) => src.startsWith(kw, at) &&
    (at === 0 || !/[A-Za-z0-9_]/.test(src[at - 1])) &&
    !/[A-Za-z0-9_]/.test(src[at + kw.length] || ' ');
  while (i < n) {
    const c = src[i];
    if (c === '#') { while (i < n && src[i] !== '\n') out += src[i++]; continue; }
    if (c === '"') { out += c; i++; while (i < n) { out += src[i]; if (src[i] === '\\') { i++; if (i < n) out += src[i++]; continue; } if (src[i] === '"') { i++; break; } i++; } continue; }
    if (atWord('test', i)) {
      // find the opening brace, skipping the name string
      let j = i + 4;
      while (j < n && /\s/.test(src[j])) j++;
      if (src[j] === '"') { j++; while (j < n && src[j] !== '"') { if (src[j] === '\\') j++; j++; } j++; }
      while (j < n && /\s/.test(src[j])) j++;
      if (src[j] === '{') {
        let depth = 0, k = j;
        for (; k < n; k++) {
          const d = src[k];
          if (d === '#') { while (k < n && src[k] !== '\n') k++; continue; }
          if (d === '"') { k++; while (k < n) { if (src[k] === '\\') { k++; k++; continue; } if (src[k] === '"') break; k++; } continue; }
          if (d === '{') depth++;
          else if (d === '}') { depth--; if (depth === 0) { k++; break; } }
        }
        i = k;   // drop the whole test block
        continue;
      }
    }
    out += c; i++;
  }
  return out;
}

function loadTasks() {
  if (!fs.existsSync(TASKS_DIR)) return [];
  return fs.readdirSync(TASKS_DIR)
    .filter(d => { try { return fs.statSync(path.join(TASKS_DIR, d)).isDirectory(); } catch { return false; } })
    .sort()
    .map(name => {
      const dir = path.join(TASKS_DIR, name);
      const reqRaw = readIf(path.join(dir, 'requires'));
      return {
        name, dir,
        bucket: name.split('-')[0] || name,
        prompt: readIf(path.join(dir, 'prompt.md')) || '',
        check: readIf(path.join(dir, 'check.myx')),
        expected: readIf(path.join(dir, 'expected.txt')),
        hostPath: fs.existsSync(path.join(dir, 'host.js')) ? path.join(dir, 'host.js') : null,
        solution: readIf(path.join(dir, 'solution.myx')),
        requires: reqRaw ? reqRaw.split('\n').map(s => s.trim()).filter(Boolean) : [],
      };
    });
}

// Strip everything a construct keyword could hide in without actually running: comments, string LITERAL
// bodies, and statically-DEAD `when <falsy-literal> { ... }` branches (dead / 0 / "" / [] / {} / void — all
// dead per SPEC §2). The verification adversary showed a keyword parked in `when dead { ... }` satisfied the
// textual gate while the real solution skipped the construct; blanking dead code before the scan kills that.
const DEAD_LITERAL = /^(dead|void|0|""|\[\s*\]|\{\s*\})/;
function codeMinusNoise(src) {
  let out = '', i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '#') { while (i < n && src[i] !== '\n') i++; out += '\n'; continue; }               // comment -> gone
    if (c === '"') { i++; while (i < n) { if (src[i] === '\\') { i += 2; continue; } if (src[i] === '"') { i++; break; } i++; } out += '""'; continue; } // string body -> gone
    // dead `when <falsy-literal> { ... }` -> drop the block (its keywords never execute)
    if (src.startsWith('when', i) && !/[A-Za-z0-9_]/.test(src[i - 1] || ' ')) {
      let j = i + 4;
      while (j < n && /\s/.test(src[j])) j++;
      const rest = src.slice(j);
      const m = rest.match(DEAD_LITERAL);
      if (m) {
        let k = j + m[0].length;
        while (k < n && /\s/.test(src[k])) k++;
        if (src[k] === '{') {
          let depth = 0;
          for (; k < n; k++) {
            const d = src[k];
            if (d === '#') { while (k < n && src[k] !== '\n') k++; continue; }
            if (d === '"') { k++; while (k < n) { if (src[k] === '\\') { k += 2; continue; } if (src[k] === '"') break; k++; } continue; }
            if (d === '{') depth++;
            else if (d === '}') { depth--; if (depth === 0) { k++; break; } }
          }
          i = k; out += ' '; continue;   // the whole dead block is removed
        }
      }
    }
    out += c; i++;
  }
  return out;
}

// A required construct must literally appear in the LIVE solution source (word-boundary match, after
// codeMinusNoise). Closes the "passes without the construct" holes (sequential loop instead of dispatch/
// gather; when-chain instead of match; and the dead-branch bypass the verification adversary found).
// Honest limit: this is a best-effort STATIC gate — a keyword hidden behind a runtime-dead non-literal
// condition (`when someFalseVar {...}`) could still slip; the reference solutions + thick checks are the
// real guarantee. A benign model writing a solution has no incentive to hide the construct, so the realistic
// failure mode (genuinely skipping the construct) is caught.
function missingConstruct(src, requires) {
  const live = codeMinusNoise(String(src));
  for (const kw of requires) {
    const re = new RegExp('(^|[^A-Za-z0-9_])' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^A-Za-z0-9_]|$)');
    if (!re.test(live)) return kw;
  }
  return null;
}

function score(task, solutionSrc) {
  if (solutionSrc == null || !String(solutionSrc).trim()) return { pass: false, errClass: 'no-solution', detail: 'no solution produced' };

  const miss = missingConstruct(solutionSrc, task.requires);
  if (miss) return { pass: false, errClass: 'missing-construct', detail: `required construct '${miss}' not used` };

  const pe = parseError(solutionSrc);
  if (pe) return { pass: false, errClass: 'parse', detail: pe.slice(0, 180) };

  if (task.check != null) {                                   // Type A — checks.myx via runTests
    const graded = stripTests(solutionSrc) + '\n\n' + task.check;   // drop the model's own tests; score only the check's
    let res;
    try { res = myxo.runTests(graded, { dir: task.dir, output: () => {}, maxSteps: MAX_STEPS }); }
    catch (e) { return { pass: false, errClass: 'runtime', detail: String((e && e.message) || e).slice(0, 180) }; }
    if (!res.results || res.results.length === 0) return { pass: false, errClass: 'no-tests', detail: 'no tests ran' };
    if (res.failed === 0) return { pass: true, errClass: null, detail: `${res.passed}/${res.results.length} expects` };
    const bad = res.results.find(r => !r.ok);
    return { pass: false, errClass: 'assert', detail: (bad ? (bad.name + (bad.error ? ': ' + bad.error : '')) : `${res.failed} failed`).slice(0, 180) };
  }

  if (task.expected != null) {                                // Type B — expected.txt via run() + host natives
    let natives, valueCaps, expectAudit;
    if (task.hostPath) { try { const h = require(task.hostPath); natives = h.natives; valueCaps = h.valueCaps; expectAudit = h.expectAudit; } catch (e) { return { pass: false, errClass: 'host-error', detail: String(e.message).slice(0, 180) }; } }
    let out, ledger = [];
    try { out = myxo.run(solutionSrc, { capture: true, natives, valueCaps, dir: task.dir, requireManifest: !!natives, maxSteps: MAX_STEPS, onAudit: l => { ledger = l || []; } }); }
    catch (e) { return { pass: false, errClass: 'runtime', detail: String((e && e.message) || e).slice(0, 180) }; }
    if (norm(out) !== norm(task.expected)) return { pass: false, errClass: 'output', detail: 'got: ' + norm(out).replace(/\n/g, ' | ').slice(0, 120) };
    // Fence tasks: the transcript matching is not enough — the fence must have actually FIRED. host.js's
    // expectAudit(ledger) inspects the recorded {cap,args,ok} calls/refusals; a hardcoded-emit cheat has an
    // empty ledger and FAILs here (the CRITICAL the gate found).
    if (expectAudit) {
      let ok;
      try { ok = expectAudit(ledger); } catch (e) { return { pass: false, errClass: 'audit-error', detail: String(e.message).slice(0, 180) }; }
      if (!ok) return { pass: false, errClass: 'fence', detail: 'output matched but the capability fence was not exercised as required (audit ledger check failed)' };
    }
    return { pass: true, errClass: null, detail: expectAudit ? 'output + fence verified' : 'output matches' };
  }

  return { pass: false, errClass: 'no-check', detail: 'task has neither check.myx nor expected.txt' };
}

async function getSolution(task, mode, gen) {
  if (mode === 'ref') return task.solution;
  // NX_EVAL_SPEC picks which language doc the model sees: 'spec' (full SPEC.md, the default) or 'prompt'
  // (MYXO_PROMPT.md, the Phase-5 distilled teaching prompt). The delta between the two is a real Phase-5 number.
  const which = (process.env.NX_EVAL_SPEC || 'spec').toLowerCase();
  const file = which === 'prompt' || which === 'nx_prompt' ? 'MYXO_PROMPT.md' : 'SPEC.md';
  return await gen.generate(task, { specPath: path.join(ROOT, '..', file) });
}

async function main() {
  const args = process.argv.slice(2);
  const mIx = args.indexOf('--model');
  const mode = mIx >= 0 ? 'model' : 'ref';
  const modelName = mIx >= 0 ? (args[mIx + 1] || 'ollama') : 'ref';
  let gen = null, modelId = modelName;
  if (mode === 'model') {
    const genPath = path.join(ROOT, 'generators', modelName + '.js');
    if (!fs.existsSync(genPath)) { console.error('no generator "' + modelName + '" (see generators/)'); process.exit(2); }
    gen = require(genPath);
    modelId = gen.modelId || modelName;   // concrete model id (e.g. ollama/qwen2.5-coder:7b) for provenance
  }
  const tasks = loadTasks();
  if (!tasks.length) { console.error('no tasks in ' + TASKS_DIR); process.exit(2); }
  const stamp = new Date().toISOString();
  const rows = [];
  for (const t of tasks) {
    let solution = null, genErr = null;
    try { solution = await getSolution(t, mode, gen); } catch (e) { genErr = String(e.message); }
    const r = genErr ? { pass: false, errClass: 'gen-error', detail: genErr.slice(0, 180) } : score(t, solution);
    rows.push({ ts: stamp, model: modelName, modelId, task: t.name, bucket: t.bucket, pass: r.pass, errClass: r.errClass, detail: r.detail });
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${t.bucket.padEnd(12)} ${t.name.padEnd(26)} ${r.pass ? r.detail : '[' + r.errClass + '] ' + r.detail}`);
  }
  const passed = rows.filter(r => r.pass).length, total = rows.length;
  const byB = {};
  for (const r of rows) { (byB[r.bucket] = byB[r.bucket] || { p: 0, n: 0 }); byB[r.bucket].n++; if (r.pass) byB[r.bucket].p++; }
  console.log('\n=== SCOREBOARD [' + modelId + '] ===');
  for (const b of Object.keys(byB).sort()) console.log('  ' + b.padEnd(14) + byB[b].p + '/' + byB[b].n);
  console.log('  ' + 'TOTAL'.padEnd(14) + passed + '/' + total);
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const outFile = path.join(RESULTS_DIR, modelName + '.jsonl');
  fs.appendFileSync(outFile, rows.map(r => JSON.stringify(r)).join('\n') + '\n');   // append: history accrues (one run per ts)
  console.log('\nresults -> ' + outFile);
  process.exit(passed === total ? 0 : 1);
}

// Pure scoring surface, exported so the harness's own regression tests can drive it without process.exit.
module.exports = { score, stripTests, missingConstruct, codeMinusNoise, parseError, loadTasks };

if (require.main === module) main().catch(e => { console.error('harness error:', e && e.stack || e); process.exit(2); });
