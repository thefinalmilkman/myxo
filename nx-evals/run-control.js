#!/usr/bin/env node
'use strict';
// Python control-group scorer — the OTHER half of the Phase-1 product metric.
// The ROADMAP thesis: Nx makes a model write correct, *safe* agent-code more reliably than Python-in-a-sandbox.
// The only way to know is the DELTA: run the SAME problems in Python and compare pass rates bucket-by-bucket.
//
//   node run-control.js            # --ref: run each task's Python reference solution (validates the control set)
//   node run-control.js --model claude   # a model writes Python for each task's control-prompt (opt-in; costs)
//   node run-control.js --model ollama    # local free baseline
//
// A control lives at tasks/<name>/control/ :
//   prompt.md      — the SAME problem, worded for Python (spec-free; Python is assumed known).
//   solution.py    — the reference Python solution (proves solvability; used by --ref).
//   check.py       — Python assertions against the solution's names (raises on failure). MUST be thick/varied
//                    (same anti-hardcode rule as the Nx checks).
// A task WITHOUT a control/ dir is skipped and reported as 'no-control' (honest: not every bucket maps to a
// fair plain-Python control — fence/concurrency are the Nx-differentiated buckets; see BASELINE.md).
//
// Scoring runs solution.py + check.py together in a FRESH python subprocess with a wall-clock timeout
// (the analog of the Nx harness's fuel bound — a non-terminating solution can't hang the run).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = __dirname;
const TASKS_DIR = path.join(ROOT, 'tasks');
const RESULTS_DIR = path.join(ROOT, 'results');
const PYTHON = process.env.NX_EVAL_PYTHON || 'python';
const TIMEOUT_MS = 15000;

const readIf = p => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);

function loadControls() {
  if (!fs.existsSync(TASKS_DIR)) return [];
  return fs.readdirSync(TASKS_DIR)
    .filter(d => { try { return fs.statSync(path.join(TASKS_DIR, d)).isDirectory(); } catch { return false; } })
    .sort()
    .map(name => {
      const cdir = path.join(TASKS_DIR, name, 'control');
      return {
        name,
        bucket: name.split('-')[0] || name,
        hasControl: fs.existsSync(cdir),
        prompt: readIf(path.join(cdir, 'prompt.md')) || '',
        solution: readIf(path.join(cdir, 'solution.py')),
        check: readIf(path.join(cdir, 'check.py')),
      };
    });
}

// Run python solution+check in one subprocess. Exit 0 = pass; a non-zero exit / raised AssertionError = fail;
// timeout = fail (fuel analog). We never eval untrusted output beyond running it in a plain subprocess — the
// control is a coding-correctness measure, not a security surface (that's the fence bucket's job, in Nx).
function scorePython(source) {
  const res = spawnSync(PYTHON, ['-c', source], { timeout: TIMEOUT_MS, encoding: 'utf8' });
  if (res.error) {
    if (res.error.code === 'ETIMEDOUT') return { pass: false, errClass: 'timeout', detail: 'exceeded ' + TIMEOUT_MS + 'ms' };
    if (res.error.code === 'ENOENT') return { pass: false, errClass: 'no-python', detail: 'python not found (set NX_EVAL_PYTHON)' };
    return { pass: false, errClass: 'spawn-error', detail: String(res.error.message).slice(0, 160) };
  }
  if (res.status === 0) return { pass: true, errClass: null, detail: 'python checks passed' };
  const err = (res.stderr || '').trim();
  const cls = /SyntaxError|IndentationError/.test(err) ? 'parse' : /AssertionError/.test(err) ? 'assert' : 'runtime';
  const last = err.split('\n').filter(Boolean).pop() || ('exit ' + res.status);
  return { pass: false, errClass: cls, detail: last.slice(0, 160) };
}

async function getPython(task, mode, gen) {
  if (mode === 'ref') return task.solution;
  return await gen.generate({ prompt: task.prompt, name: task.name }, { specPath: null, language: 'python' });
}

async function main() {
  const args = process.argv.slice(2);
  const mIx = args.indexOf('--model');
  const mode = mIx >= 0 ? 'model' : 'ref';
  const modelName = mIx >= 0 ? (args[mIx + 1] || 'ollama') : 'ref';
  let gen = null, modelId = 'control/' + modelName;
  if (mode === 'model') {
    const genPath = path.join(ROOT, 'generators', modelName + '-py.js');
    if (!fs.existsSync(genPath)) { console.error('no python generator "' + modelName + '-py" (see generators/); --ref works without one'); process.exit(2); }
    gen = require(genPath);
    modelId = 'control/' + (gen.modelId || modelName);
  }
  const tasks = loadControls();
  if (!tasks.length) { console.log('no tasks in ' + TASKS_DIR + ' — nothing to score'); process.exit(0); }
  const stamp = new Date().toISOString();
  const rows = [];
  for (const t of tasks) {
    let r;
    if (!t.hasControl) { r = { pass: false, errClass: 'no-control', detail: 'no python control for this task (Nx-differentiated bucket)' }; }
    else {
      let sol = null, genErr = null;
      try { sol = await getPython(t, mode, gen); } catch (e) { genErr = String(e.message); }
      if (genErr) r = { pass: false, errClass: 'gen-error', detail: genErr.slice(0, 160) };
      else if (!sol || !String(sol).trim()) r = { pass: false, errClass: 'no-solution', detail: 'empty' };
      else if (t.check == null) r = { pass: false, errClass: 'no-check', detail: 'control has no check.py' };
      else r = scorePython(sol + '\n\n' + t.check);
    }
    rows.push({ ts: stamp, model: 'control/' + modelName, modelId, task: t.name, bucket: t.bucket, pass: r.pass, errClass: r.errClass, detail: r.detail });
    console.log(`${r.pass ? 'PASS' : (r.errClass === 'no-control' ? 'SKIP' : 'FAIL')}  ${t.bucket.padEnd(12)} ${t.name.padEnd(26)} ${r.pass ? r.detail : '[' + r.errClass + '] ' + r.detail}`);
  }
  // Delta scoreboard: control counts only tasks that HAVE a control (skips are excluded, and flagged, per no-silent-caps).
  const scored = rows.filter(r => r.errClass !== 'no-control');
  const passed = scored.filter(r => r.pass).length;
  const skipped = rows.length - scored.length;
  const byB = {};
  for (const r of scored) { (byB[r.bucket] = byB[r.bucket] || { p: 0, n: 0 }); byB[r.bucket].n++; if (r.pass) byB[r.bucket].p++; }
  console.log('\n=== CONTROL SCOREBOARD [' + modelId + '] ===');
  for (const b of Object.keys(byB).sort()) console.log('  ' + b.padEnd(14) + byB[b].p + '/' + byB[b].n);
  console.log('  ' + 'TOTAL'.padEnd(14) + passed + '/' + scored.length + (skipped ? `  (${skipped} task(s) skipped — no python control)` : ''));
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const outFile = path.join(RESULTS_DIR, 'control-' + modelName + '.jsonl');
  fs.appendFileSync(outFile, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  console.log('\nresults -> ' + outFile);
  // exit 0 when nothing failed: all controls passed, OR none are authored yet (all skipped — not a failure).
  process.exit(passed === scored.length ? 0 : 1);
}

module.exports = { scorePython, loadControls };
if (require.main === module) main().catch(e => { console.error('control harness error:', e && e.stack || e); process.exit(2); });
