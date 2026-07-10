'use strict';
// lexer.js — turns Myxo source text into a flat list of tokens.
// Each token carries its line and column so errors can point at the source.

const { MyxoError } = require('./errors');

// The words that mean something structural in Myxo. Everything else that looks
// like a name is an identifier (a pathway or an agent).
const KEYWORDS = new Set([
  'seed', 'decay', 'emit',
  'when', 'otherwise',
  'reinforce', 'times',
  'for', 'each', 'in',
  'agent', 'report',
  'attempt', 'rescue', 'fail',
  'weave', 'expose', 'as', 'needs',
  'live', 'dead', 'void',
  'and', 'or', 'not',
  'test', 'expect', 'match',
  'dispatch', 'gather',
  'spawn', 'give', 'take', 'yield',
]);

// Two-character operators must be matched before their single-char prefixes.
const TWO_CHAR = {
  '>=': 'GE', '<=': 'LE', '==': 'EQ', '!=': 'NE',
};
const ONE_CHAR = {
  '+': 'PLUS', '-': 'MINUS', '*': 'STAR', '/': 'SLASH', '%': 'PERCENT',
  '>': 'GT', '<': 'LT', '=': 'ASSIGN',
  '(': 'LPAREN', ')': 'RPAREN',
  '{': 'LBRACE', '}': 'RBRACE',
  '[': 'LBRACKET', ']': 'RBRACKET',
  ',': 'COMMA', ':': 'COLON',
  '|': 'PIPE',
};

function isDigit(c) { return c >= '0' && c <= '9'; }
function isIdentStart(c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_'; }
function isIdentPart(c) { return isIdentStart(c) || isDigit(c); }

// tokenize(src[, comments]) — if a `comments` array is passed, each `# ...` comment is recorded there as
// { line, col, text, trailing } (trailing = code already appeared on that line). Comments are NOT tokens; this
// is so the formatter can re-attach them using the REAL string/interpolation-aware scanner (not a weaker copy).
function tokenize(src, comments) {
  const tokens = [];
  let i = 0;
  let line = 1;
  let col = 1;
  let lastTokenLine = 0;   // for trailing-comment detection

  const peek = (o = 0) => src[i + o];
  const advance = () => {
    const c = src[i++];
    if (c === '\n') { line++; col = 1; } else { col++; }
    return c;
  };
  const push = (type, value, startLine, startCol) => {
    tokens.push({ type, value, line: startLine, col: startCol });
    lastTokenLine = startLine;
  };

  while (i < src.length) {
    const c = peek();

    // Whitespace (including newlines — Myxo is newline-insensitive).
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { advance(); continue; }

    // Comments run from '#' to end of line. (Reached only OUTSIDE strings/interpolation — the string branch
    // below consumes any '#' within a literal — so capture here is string-safe.)
    if (c === '#') {
      const cl = line, cc = col;
      advance();
      let text = '';
      while (i < src.length && peek() !== '\n') text += advance();
      if (comments) comments.push({ line: cl, col: cc, text: text.trim(), trailing: lastTokenLine === cl });
      continue;
    }

    const startLine = line, startCol = col;

    // Numbers: integer or decimal.
    if (isDigit(c)) {
      let num = '';
      while (i < src.length && isDigit(peek())) num += advance();
      if (peek() === '.' && isDigit(peek(1))) {
        num += advance(); // the dot
        while (i < src.length && isDigit(peek())) num += advance();
      }
      push('NUMBER', parseFloat(num), startLine, startCol);
      continue;
    }

    // Strings: double-quoted, with escapes and {expr} interpolation.
    if (c === '"') {
      advance(); // opening quote
      const segs = [];
      let lit = '';
      let interpolated = false;
      while (i < src.length && peek() !== '"') {
        const ch = peek();
        if (ch === '\\') {
          advance();
          const esc = advance();
          lit += esc === 'n' ? '\n' : esc === 't' ? '\t' : esc === '"' ? '"'
            : esc === '\\' ? '\\' : esc === '{' ? '{' : esc === '}' ? '}' : esc;
          continue;
        }
        if (ch === '{') {
          interpolated = true;
          if (lit) { segs.push({ t: 'lit', v: lit }); lit = ''; }
          advance(); // consume the opening {
          let depth = 1, exprSrc = '';
          while (i < src.length && depth > 0) {
            const e = peek();
            if (e === '"') {                      // copy a nested string verbatim
              exprSrc += advance();
              while (i < src.length && peek() !== '"') {
                if (peek() === '\\') exprSrc += advance();
                exprSrc += advance();
              }
              if (i < src.length) exprSrc += advance();
              continue;
            }
            if (e === '{') { depth++; exprSrc += advance(); continue; }
            if (e === '}') { depth--; advance(); if (depth === 0) break; exprSrc += '}'; continue; }
            exprSrc += advance();
          }
          if (depth > 0) throw new MyxoError('unterminated { } interpolation in string', startLine, startCol);
          segs.push({ t: 'expr', v: exprSrc });
          continue;
        }
        lit += advance();
      }
      if (i >= src.length) throw new MyxoError('unterminated string', startLine, startCol);
      advance(); // closing quote
      if (interpolated) {
        if (lit) segs.push({ t: 'lit', v: lit });
        push('TEMPLATE', segs, startLine, startCol);
      } else {
        push('STRING', lit, startLine, startCol);
      }
      continue;
    }

    // Identifiers and keywords.
    if (isIdentStart(c)) {
      let name = '';
      while (i < src.length && isIdentPart(peek())) name += advance();
      push(KEYWORDS.has(name) ? 'KEYWORD' : 'IDENT', name, startLine, startCol);
      continue;
    }

    // Three-dot ellipsis: a rest parameter (`...rest`).
    if (c === '.' && peek(1) === '.' && peek(2) === '.') {
      advance(); advance(); advance();
      push('ELLIPSIS', '...', startLine, startCol);
      continue;
    }

    // Operators and punctuation.
    const two = c + (peek(1) || '');
    if (TWO_CHAR[two]) { advance(); advance(); push(TWO_CHAR[two], two, startLine, startCol); continue; }
    if (ONE_CHAR[c]) { advance(); push(ONE_CHAR[c], c, startLine, startCol); continue; }

    throw new MyxoError(`unexpected character '${c}'`, startLine, startCol);
  }

  push('EOF', null, line, col);
  return tokens;
}

module.exports = { tokenize, KEYWORDS };
