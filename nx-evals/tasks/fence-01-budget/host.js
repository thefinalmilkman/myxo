'use strict';
// Trusted host for the fence task. Grants lookup + spend generously; the SCRIPT's own manifest
// (needs lookup, spend(max 5)) is what bounds it. `purge` is intentionally NOT granted.
exports.natives = {
  lookup: (a) => "Vallarta's",
  spend: (a) => "spent " + a[0],
};
// Host-fixed metering (post-warden): `spend` is VALUE-metered (max/total apply to its numeric first arg).
// Without this, max/total would count CALLS instead — the untrusted manifest can't choose its own metering.
exports.valueCaps = ['spend'];

// The fence must actually FIRE — matching stdout is not enough (the two-agent gate proved a hardcoded-emit
// cheat with an empty ledger scored PASS). The harness passes nx.run's audit ledger here; a real solution
// leaves a trail on the GRANTED capabilities: lookup succeeded, a spend within cap succeeded, an over-cap
// spend was refused. (The undeclared `purge` is never granted, so it errors as an unknown pathway and never
// reaches the capability ledger — the fence-by-absence model; that leg is verified by the output line
// "undeclared blocked".) Ledger entries are { cap, args, ok, result|error }; an empty ledger (the cheat)
// fails every clause below.
exports.expectAudit = (ledger) => {
  const has = (cap, ok) => ledger.some(e => e.cap === cap && e.ok === ok);
  return has('lookup', true)    // lookup("x") succeeded
    && has('spend', true)       // spend(3) within the cap succeeded
    && has('spend', false);     // spend(9) over the per-call max was refused by the fence
};
