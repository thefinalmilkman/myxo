'use strict';
// Trusted host. `pay` is VALUE-metered (per-call max 10 from the manifest); `log` is a free-count fallback.
// The script pays when within cap, and on a fence denial rescues by logging the refusal and continuing.
exports.natives = {
  pay: (a) => "ok:" + a[0],
  log: (a) => "logged",
};
exports.valueCaps = ['pay'];

// The fence must actually FIRE. Ledger entries are { cap, args, ok, result|error }.
// Correct run: pay(8) ok; pay(25) REFUSED over per-call max; log fires in the rescue for the refusal;
// pay(3) ok. The denial must have been an actual fence refusal (ok:false), and the fallback log must
// have run (proving the rescue path executed, not a hardcoded emit).
exports.expectAudit = (ledger) => {
  const payOk = ledger.filter(e => e.cap === 'pay' && e.ok === true);
  const payRefused = ledger.filter(e => e.cap === 'pay' && e.ok === false && /per-call max/.test(e.error || ''));
  const logOk = ledger.filter(e => e.cap === 'log' && e.ok === true);
  return payOk.length === 2       // pay(8) and pay(3) succeeded
    && payRefused.length === 1    // pay(25) was refused by the value fence
    && logOk.length === 1;        // the rescue logged exactly the one refusal
};
