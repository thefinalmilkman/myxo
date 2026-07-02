'use strict';
// command-fence.js -- turn an ARBITRARY-CODE capability (a raw shell) back into a set of STRUCTURED, bounded,
// injection-proof capabilities the Warden can certify.
//
// The problem: granting `sh("...")` grants the whole shell -- the receipt logs the name but the inner command is
// unbounded. The fix: don't grant a shell. Grant a fixed ALLOWLIST of named, parameterized commands. Each becomes
// its own capability (git_status, disk_free, ...), so the fence + receipt see a structured call again.
//
// Two hard guarantees make this safe, not theater:
//   1) NO SHELL. Commands run via execFileSync(program, [args]) -- a direct process spawn, NOT a shell string. So
//      metacharacters in an argument (`; | $() ` etc.) are inert: they are literal argv, never re-parsed. Injection
//      is structurally impossible, not filtered.
//   2) TYPED PARAMS. Every `{param}` slot in a command template must pass a declared policy (regex or enum) before
//      substitution -- so an argument can't smuggle in a flag or a path. Fail the policy -> refused + logged.
//
// A commandFence spec:
//   {
//     whoami:    { argv: ['whoami'] },
//     git_log:   { argv: ['git','log','--oneline','-n','{n}'], params: { n: { pattern: '^[0-9]{1,3}$' } } },
//     lookup:    { argv: ['nslookup','{host}'], params: { host: { pattern: '^[a-z0-9.-]{1,64}$' } } },
//   }
// commandFence(spec, { onEffect }) -> { name: nativeFn } ready to install as fenced capabilities.

const { execFileSync } = require('child_process');

function policyError(msg) { const e = new Error(msg); e.nxFence = true; return e; }  // a policy denial (routers can't route around)

function commandFence(spec, opts = {}) {
  const onEffect = typeof opts.onEffect === 'function' ? opts.onEffect : null;
  const timeout = Number.isFinite(opts.timeout) && opts.timeout > 0 ? opts.timeout : 5000;
  const maxBuffer = Number.isFinite(opts.maxBuffer) && opts.maxBuffer > 0 ? opts.maxBuffer : (1 << 20);
  const natives = {};

  for (const [name, def] of Object.entries(spec)) {
    if (!Array.isArray(def.argv) || def.argv.length === 0) throw new Error(`commandFence: '${name}' needs a non-empty argv template`);
    const template = def.argv;
    // the PROGRAM (argv[0]) is always host-fixed -- a parameterized program name would let the script choose what
    // runs, which is exactly the arbitrary-code hole this module closes.
    if (/\{\w+\}/.test(String(template[0]))) throw new Error(`commandFence: '${name}' program (argv[0]) must be a literal, not a {param}`);
    const params = def.params || {};
    const paramNames = Object.keys(params);
    // pre-compile each param's validator; a param with no validator is a spec error (never allow an unchecked slot)
    const validators = {};
    for (const [p, rule] of Object.entries(params)) {
      if (rule && Array.isArray(rule.enum)) validators[p] = { test: (v) => rule.enum.indexOf(v) >= 0, kind: 'enum ' + JSON.stringify(rule.enum) };
      else if (rule && typeof rule.pattern === 'string') { const re = new RegExp(rule.pattern); validators[p] = { test: (v) => re.test(v), kind: 'match ' + rule.pattern }; }
      else throw new Error(`commandFence: param '${p}' of '${name}' needs a { pattern } or { enum } policy`);
    }
    // every {slot} referenced in the template must be a declared+validated param (no unchecked substitution)
    for (const el of template) {
      const m = String(el).match(/\{(\w+)\}/g) || [];
      for (const tok of m) { const p = tok.slice(1, -1); if (!(p in validators)) throw new Error(`commandFence: '${name}' template uses {${p}} but has no validated param '${p}'`); }
    }

    natives[name] = (args) => {
      const bound = {};
      for (let i = 0; i < paramNames.length; i++) {
        const pn = paramNames[i];
        const val = args[i] === undefined || args[i] === null ? '' : String(args[i]);
        if (!validators[pn].test(val)) throw policyError(`command '${name}': argument '${pn}'=${JSON.stringify(val)} fails its policy (${validators[pn].kind})`);
        bound[pn] = val;
      }
      // substitute validated params into the argv template, then spawn WITHOUT a shell
      const argv = template.map(el => String(el).replace(/\{(\w+)\}/g, (m, p) => (p in bound ? bound[p] : m)));
      let stdout;
      try { stdout = execFileSync(argv[0], argv.slice(1), { encoding: 'utf8', timeout, maxBuffer, windowsHide: true }).replace(/\r?\n$/, ''); }
      catch (e) { throw policyError(`command '${name}' failed: ${String(e.message || e).split('\n')[0]}`); }
      if (onEffect) onEffect(name, argv, stdout);
      return stdout;
    };
  }
  return natives;
}

module.exports = { commandFence };
