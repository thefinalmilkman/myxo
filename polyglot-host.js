'use strict';
// polyglot-host.js — run an .myx script WITH the polyglot capabilities (python/node/perl/bridgeExec/sh) installed,
// under the capability fence: the script must declare a `needs` manifest, and every foreign call is audited.
//   node polyglot-host.js <file.myx> [--audit]
// This is the "real host" for scripts that orchestrate other runtimes — the fence + audit are what make that safe.

const fs = require('fs');
const path = require('path');
const { makeInterpreter } = require('./myxo');
const { installPolyglot } = require('./polyglot');
const { parse } = require('./parser');

function main() {
  const argv = process.argv.slice(2);
  const showAudit = argv.includes('--audit');
  const file = argv.find(a => !a.startsWith('--'));
  if (!file) { process.stderr.write('usage: node polyglot-host.js <file.myx> [--audit]\n'); process.exit(2); }
  let src;
  try { src = fs.readFileSync(file, 'utf8'); }
  catch { process.stderr.write(`polyglot-host: no such file: ${file}\n`); process.exit(2); }

  let out = '';
  const interp = makeInterpreter({ output: (s) => { out += s; }, dir: path.dirname(path.resolve(file)), requireManifest: true });
  installPolyglot(interp);   // grant python/node/perl/bridgeExec/sh — all fenced by the script's `needs` + audited

  let failed = null;
  try { interp.run(parse(src)); }
  catch (e) { failed = e && e.message ? e.message : String(e); }

  process.stdout.write(out);
  if (showAudit) {
    process.stderr.write('--- audit ledger (every fenced capability call) ---\n');
    for (const a of interp.audit) process.stderr.write(`  ${a.ok ? 'ok ' : 'XX '} ${a.cap}\n`);
  }
  if (failed) { process.stderr.write('nx: ' + failed + '\n'); process.exit(1); }
}

if (require.main === module) main();
module.exports = { };
