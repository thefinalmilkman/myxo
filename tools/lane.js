#!/usr/bin/env node
'use strict';
// lane.js — the yield sign for concurrent agent/human sessions in this repo (zero-dep, per repo law).
// Before EDITING a file, claim its lane; if the claim fails, YIELD (do something else or ask).
// When done, release. Locks are tiny JSON files in .lane/ (gitignored) — atomic via exclusive create.
//
//   node tools/lane.js claim <path...> --by <name> [--why "<what you're doing>"]
//   node tools/lane.js check <path...>                 # exit 0 all clear, 1 = someone holds one
//   node tools/lane.js release <path...> --by <name>   # or: release --all --by <name>
//   node tools/lane.js list                            # who holds what, since when
//   node tools/lane.js log [--last N]                  # the timestamped journal of everything done
//   node tools/lane.js clear-stale [--hours 6]         # drop locks older than N hours (dead sessions)
//
// Release refuses to drop ANOTHER session's locks without --force. Paths are normalized repo-relative,
// so `interpreter.js` and `./interpreter.js` are the same lane.
//
// THE JOURNAL: every action (claim / yield / release / refuse / force-break / stale-sweep) is appended
// to .lane/journal.jsonl with an ISO timestamp — one JSON object per line, newest last. Nothing in this
// system happens without a timestamped record.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LANE = path.join(ROOT, '.lane');
const JOURNAL = path.join(LANE, 'journal.jsonl');

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name, def) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : def; };
const has = name => argv.indexOf('--' + name) >= 0;
const paths = argv.slice(1).filter(a => !a.startsWith('--') && a !== flag('by') && a !== flag('why') && a !== flag('hours') && a !== flag('last'));

const iso = () => new Date().toISOString();   // UTC ISO — same stamp convention as myxo-evals results
function rel(p) {
  const r = path.relative(ROOT, path.resolve(ROOT, p));
  return r.split(path.sep).join('/');
}
function key(r) { return r.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '.json'; }
function ensureLane() { fs.mkdirSync(LANE, { recursive: true }); }
function readLock(f) { try { return JSON.parse(fs.readFileSync(path.join(LANE, f), 'utf8')); } catch { return null; } }
function ageMin(ts) { return Math.round((Date.now() - ts) / 60000); }

// One journal line per thing done. Best-effort: a journaling failure never breaks the lane op itself.
function journal(act, by, lockPath, detail) {
  const line = JSON.stringify({ ts: iso(), act, by: by || null, path: lockPath || null, detail: detail || null });
  try { fs.appendFileSync(JOURNAL, line + '\n'); } catch { /* journal is a record, not a gate */ }
}

function main() {
  ensureLane();
  if (cmd === 'claim') {
    const by = flag('by'), why = flag('why', '');
    if (!by) { console.error('claim needs --by <name>'); process.exit(2); }
    if (!paths.length) { console.error('claim needs at least one path'); process.exit(2); }
    const held = [];
    for (const p of paths) {
      const r = rel(p), f = path.join(LANE, key(r));
      try {
        fs.writeFileSync(f, JSON.stringify({ path: r, by, why, ts: Date.now(), at: iso() }, null, 2), { flag: 'wx' });
        journal('claim', by, r, why || null);
        console.log('CLAIMED  ' + r + '  by ' + by + '  @ ' + iso());
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        const lock = readLock(key(r));
        held.push(r + '  held by ' + (lock ? lock.by + ' (since ' + (lock.at || '?') + ', ' + ageMin(lock.ts) + 'm' + (lock.why ? ', ' + lock.why : '') + ')' : '?'));
      }
    }
    if (held.length) {
      journal('yield', by, null, 'blocked on: ' + held.map(h => h.split('  ')[0]).join(', '));
      console.error('\nYIELD — lane(s) taken:\n  ' + held.join('\n  '));
      // roll back any lanes this call DID claim: a failed batch must hold nothing (all-or-nothing)
      for (const p of paths) {
        const r = rel(p), lock = readLock(key(r));
        if (lock && lock.by === by && !held.some(h => h.startsWith(r + ' '))) {
          try { fs.unlinkSync(path.join(LANE, key(r))); } catch { /* gone */ }
          journal('rollback', by, r, 'batch failed — released');
        }
      }
      process.exit(1);
    }
  } else if (cmd === 'check') {
    if (!paths.length) { console.error('check needs at least one path'); process.exit(2); }
    let blocked = false;
    for (const p of paths) {
      const r = rel(p), lock = readLock(key(r));
      if (lock) { blocked = true; console.log('TAKEN  ' + r + '  by ' + lock.by + ' (since ' + (lock.at || '?') + ', ' + ageMin(lock.ts) + 'm' + (lock.why ? ', ' + lock.why : '') + ')'); }
      else console.log('CLEAR  ' + r);
    }
    process.exit(blocked ? 1 : 0);
  } else if (cmd === 'release') {
    const by = flag('by');
    if (!by) { console.error('release needs --by <name>'); process.exit(2); }
    const targets = has('all')
      ? fs.readdirSync(LANE).filter(f => f.endsWith('.json')).map(f => readLock(f)).filter(Boolean).map(l => l.path)
      : paths.map(rel);
    if (!targets.length) { console.log('nothing to release'); return; }
    for (const r of targets) {
      const lock = readLock(key(r));
      if (!lock) { console.log('FREE    ' + r + '  (was not locked)'); continue; }
      if (lock.by !== by && !has('force')) {
        journal('refuse', by, r, 'held by ' + lock.by);
        console.error('REFUSE  ' + r + '  held by ' + lock.by + ' (use --force to break)'); process.exitCode = 1; continue;
      }
      fs.unlinkSync(path.join(LANE, key(r)));
      journal(lock.by !== by ? 'force-break' : 'release', by, r, lock.by !== by ? 'broke ' + lock.by + "'s lock (held since " + (lock.at || '?') + ')' : null);
      console.log('RELEASED ' + r + '  @ ' + iso() + (lock.by !== by ? '  (force-broken from ' + lock.by + ')' : ''));
    }
  } else if (cmd === 'list') {
    const files = fs.readdirSync(LANE).filter(f => f.endsWith('.json'));
    if (!files.length) { console.log('no lanes held — the road is open'); return; }
    for (const f of files) {
      const l = readLock(f);
      if (l) console.log(l.path + '  by ' + l.by + '  since ' + (l.at || '?') + ' (' + ageMin(l.ts) + 'm)' + (l.why ? '  — ' + l.why : ''));
    }
  } else if (cmd === 'log') {
    if (!fs.existsSync(JOURNAL)) { console.log('journal is empty — nothing has happened yet'); return; }
    const lines = fs.readFileSync(JOURNAL, 'utf8').split('\n').filter(Boolean);
    const last = Number(flag('last', 0)) || 0;
    const show = last > 0 ? lines.slice(-last) : lines;
    for (const line of show) {
      let e; try { e = JSON.parse(line); } catch { continue; }
      console.log(e.ts + '  ' + String(e.act).padEnd(11) + ' ' + (e.by || '?').padEnd(12) + (e.path ? ' ' + e.path : '') + (e.detail ? '  — ' + e.detail : ''));
    }
  } else if (cmd === 'clear-stale') {
    const hours = Number(flag('hours', 6));
    const cutoff = Date.now() - hours * 3600000;
    let n = 0;
    for (const f of fs.readdirSync(LANE).filter(f => f.endsWith('.json'))) {
      const l = readLock(f);
      if (l && l.ts < cutoff) {
        fs.unlinkSync(path.join(LANE, f)); n++;
        journal('stale-sweep', '(sweeper)', l.path, 'was ' + l.by + ', held since ' + (l.at || '?'));
        console.log('STALE   ' + l.path + '  (was ' + l.by + ', ' + ageMin(l.ts) + 'm)');
      }
    }
    if (!n) console.log('no stale lanes (older than ' + hours + 'h)');
  } else {
    console.log('usage: node tools/lane.js <claim|check|release|list|log|clear-stale> [paths...] [--by name] [--why text] [--all] [--force] [--hours N] [--last N]');
    process.exit(2);
  }
}

main();
