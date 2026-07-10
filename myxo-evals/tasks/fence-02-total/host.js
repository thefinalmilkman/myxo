'use strict';
// Trusted host. Grants `charge` (a free-count capability) and `spend`. The SCRIPT's own manifest
// `needs charge, spend(max 5, total 12)` is what bounds it. `spend` is VALUE-metered: max caps a
// single call's numeric first arg, total caps CUMULATIVE spend. Only successful calls count toward total.
exports.natives = {
  charge: (a) => "channel " + a[0],
  spend: (a) => "spent " + a[0],
};
exports.valueCaps = ['spend'];

// The fence must actually FIRE. Ledger entries are { cap, args, ok, result|error }.
// A correct run leaves: charge ok; spend(5) ok; spend(4) ok (cumulative 9); spend(4) REFUSED
// (9+4=13 > total 12); spend(9) REFUSED (over per-call max 5). An empty/hardcoded-emit ledger fails.
exports.expectAudit = (ledger) => {
  const spendOk = ledger.filter(e => e.cap === 'spend' && e.ok === true);
  const overTotal = ledger.some(e => e.cap === 'spend' && e.ok === false && /total/.test(e.error || ''));
  const overMax = ledger.some(e => e.cap === 'spend' && e.ok === false && /per-call max/.test(e.error || ''));
  return ledger.some(e => e.cap === 'charge' && e.ok === true) // free-count capability granted
    && spendOk.length === 2                                    // exactly two spends succeeded (5 then 4)
    && overTotal                                               // the third spend broke the total budget
    && overMax;                                                // the 9 broke the per-call max
};
