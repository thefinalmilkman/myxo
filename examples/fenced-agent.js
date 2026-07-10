'use strict';
// fenced-agent.js — Myxo as a SAFE ACTION-LANGUAGE.
//
// The point: an agent written in Myxo can do EXACTLY what the host hands it — and
// nothing else. Dangerous powers aren't "blocked" by a check it might bypass;
// they simply do not exist in its world. And the powers you DO grant, you shape.
// Same law as Zero's honesty guard and the outward gate: capability by explicit
// grant, fenced by construction. Swap the mocks below for james.db / telegram /
// the real outward gate and this is production.
//
// Run: node examples/fenced-agent.js

const { run } = require('../myxo');

const bar = (t) => console.log('\n\x1b[36m=== ' + t + ' ===\x1b[0m');

// ── Capabilities the host chooses to expose. Read-ish + a notify. No spend, no delete. ──
const safeWorld = {
  lookup: (a) => {
    const db = { tacos: 'Tacos Los Reyes (Port Arthur)', vallartas: "Vallarta's Grill" };
    return db[String(a[0]).toLowerCase()] || 'unknown lead';
  },
  notify: (a) => { console.log('   \x1b[90m[host] notify():\x1b[0m ' + a[0]); return true; },
};

// ── Act 1: the well-behaved agent does real work with only what it was given. ──
bar('Agent #1 — works inside its grant { lookup, notify }');
process.stdout.write(run(`
emit "waking up in a world that holds only lookup + notify"
seed lead = lookup("tacos")
emit "looked up a lead: " + lead
notify("drafted a follow-up for " + lead)
emit "done — and I never had the power to do harm"
`, { natives: safeWorld, capture: true }));

// ── Act 2: an overreaching agent tries to spend money it was never handed. ──
bar('Agent #2 — reaches for power it was not granted');
try {
  run(`
emit "trying to move money..."
spend(5000)
emit "this line must never run"
`, { natives: safeWorld, capture: true });
  console.log('   \x1b[31m!! FENCE FAILED\x1b[0m');
} catch (e) {
  console.log('   \x1b[32m[FENCE HELD]\x1b[0m ' + e.message.split('\n')[0]);
  console.log('   spend() is not a thing in this agent\'s universe. There is nothing to bypass.');
}

// ── Act 3: grant spend — but SHAPE it. The host caps the rope. (the outward gate, as a native) ──
bar('Agent #3 — granted a GATED spend (host caps at $5)');
const gatedWorld = Object.assign({}, safeWorld, {
  spend: (a) => {
    const amt = Number(a[0]) || 0;
    return amt > 5 ? ('REFUSED by host: $' + amt + ' over the $5 cap') : ('sent $' + amt);
  },
});
process.stdout.write(run(`
emit spend(3)
emit spend(5000)
`, { natives: gatedWorld, capture: true }));
console.log('   \x1b[90mthe agent can act — but only as far as the host lets the rope run.\x1b[0m');

// ── Act 4: the other Myxo superpower — useful pathways reinforce, dead ones decay. ──
bar('The living mesh — reinforce through use, prune the silent');
process.stdout.write(run(`
seed telegram = "route:telegram"
seed wallet   = "route:wallet"
seed dead_path = "route:never-used"
emit telegram emit telegram emit telegram
emit wallet   emit wallet
seed swept = prune(2)
emit "pruned " + str(swept) + " silent pathway(s) from the mesh"
`, { natives: {}, capture: true, trace: true }));

console.log('\n\x1b[36m=== the law ===\x1b[0m');
console.log('An agent does exactly what it was handed — no more. Power is granted, then shaped.');
console.log('Used pathways strengthen; silent ones get pruned. The philosophy IS the runtime.');
