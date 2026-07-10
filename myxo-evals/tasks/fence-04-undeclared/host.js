'use strict';
// Trusted host that GRANTS BOTH readFile and writeFile. The point: the script's manifest declares only
// `readFile`, so the fence REFUSES writeFile even though the host granted it (manifest is the ceiling).
// A refused-but-granted capability DOES reach the audit ledger as ok:false (distinct from a never-granted
// name, which would just be an unknown pathway).
exports.natives = {
  readFile: (a) => "contents-of:" + a[0],
  writeFile: (a) => "wrote:" + a[1] + "->" + a[0],
};
// no valueCaps.

// The fence must actually FIRE. Ledger entries are { cap, args, ok, result|error }.
// Correct run: readFile ok (twice); writeFile REFUSED as not-declared. The write native must NEVER
// have run (its side effect would be observable), so there must be NO writeFile entry with ok:true.
exports.expectAudit = (ledger) => {
  const readOk = ledger.filter(e => e.cap === 'readFile' && e.ok === true);
  const writeRefused = ledger.some(e => e.cap === 'writeFile' && e.ok === false && /not declared/.test(e.error || ''));
  const writeRan = ledger.some(e => e.cap === 'writeFile' && e.ok === true);
  return readOk.length === 2      // both reads went through
    && writeRefused               // the undeclared write was refused by the fence
    && !writeRan;                 // and the write native never actually executed
};
