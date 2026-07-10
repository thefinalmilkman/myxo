'use strict';
// errors.js — the single error type used across every stage of Myxo.
// Carrying line/col means the lexer, parser, and interpreter can all point
// the user at exactly where their program went wrong.

class MyxoError extends Error {
  constructor(message, line = null, col = null) {
    super(message);
    this.name = 'MyxoError';
    this.line = line;
    this.col = col;
  }

  // A human-facing report: the message, where it happened, and — when the failure
  // travelled up through agent calls — the chain of calls that led there, innermost
  // first. `nxStack` is stamped by the interpreter at the deepest agent boundary.
  format() {
    const where = this.line != null ? ` (line ${this.line})` : '';
    let out = `Myxo error${where}: ${this.message}`;
    const s = this.nxStack;
    if (s && s.length) {
      const MAX = 8;                       // deep recursion shouldn't print a wall of frames
      const shown = Math.min(MAX, s.length);
      for (let k = 0; k < shown; k++) {    // innermost first
        const f = s[s.length - 1 - k];
        out += `\n  in ${f.name} (called at line ${f.line})`;
      }
      if (s.length > MAX) out += `\n  ... and ${s.length - MAX} more frame(s)`;
    }
    return out;
  }
}

// A failed `expect` inside a `test` block. Deliberately NOT an MyxoError, so the code
// under test can't `rescue` an assertion failure — only the test runner catches it.
class NxAssertError extends Error {
  constructor(message, line = null) {
    super(message);
    this.name = 'NxAssertError';
    this.line = line;
    this.nxAssert = true;
  }
}

module.exports = { MyxoError, NxAssertError };
