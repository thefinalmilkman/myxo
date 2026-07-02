'use strict';
// Trusted host. Grants `lookup` and `notify`. NEITHER is value-metered (valueCaps is empty), so the
// script's `notify(total 2)` caps notify by CALL COUNT: at most 2 successful notify calls, the 3rd refused.
exports.natives = {
  lookup: (a) => "record:" + a[0],
  notify: (a) => "sent:" + a[0],
};
// no valueCaps -> all caps are count-metered.

// The fence must actually FIRE. Ledger entries are { cap, args, ok, result|error }.
// Correct run: lookup ok; notify ok x2; notify REFUSED for exceeding the call budget.
// A hardcoded-emit cheat with an empty ledger fails every clause.
exports.expectAudit = (ledger) => {
  const notifyOk = ledger.filter(e => e.cap === 'notify' && e.ok === true);
  const notifyRefused = ledger.some(e => e.cap === 'notify' && e.ok === false && /budget|call/.test(e.error || ''));
  return ledger.some(e => e.cap === 'lookup' && e.ok === true)
    && notifyOk.length === 2        // exactly two notifies got through the count meter
    && notifyRefused;               // the third was refused by the call budget
};
