'use strict';
// format.js - canonical Myxo source printer. It formats the parsed AST, so invalid code is refused instead of
// guessed through. Comments ARE preserved: they aren't in the AST, so we collect them from the REAL lexer
// (string/interpolation-aware) and re-attach by line — own-line comments above the next statement, a trailing
// comment on its statement's line. v1 scope is statement-granular: none are ever dropped or fabricated, but a
// comment trailing a one-line block or a multi-line construct, or one inside an inline `agent(){}` expression,
// may render on its own line / shift to the nearest statement boundary. `--drop-comments` strips them.

const { parse } = require('./parser');
const { tokenize } = require('./lexer');

const PREC = { or: 1, and: 2, '==': 3, '!=': 3, '>': 4, '<': 4, '>=': 4, '<=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };
const IND = '  ';

function q(s) { return JSON.stringify(String(s)); }
function pad(n) { return IND.repeat(n); }

function formatSource(src, opts = {}) {
  if (opts.dropComments) return formatProgram(parse(src), []);
  const comments = [];
  tokenize(src, comments);   // the real, string-aware scanner — never mistakes a '#' inside a string for a comment
  return formatProgram(parse(src), comments);
}

function newCtx(comments) { return { comments: comments || [], i: 0 }; }
function ownLineComments(ctx, beforeLine, level) {   // flush every comment strictly before `beforeLine`, each on its own line
  let s = '';
  while (ctx.i < ctx.comments.length && ctx.comments[ctx.i].line < beforeLine) {
    const c = ctx.comments[ctx.i++];
    s += pad(level) + (c.text ? '# ' + c.text : '#') + '\n';
  }
  return s;
}
function trailingComment(ctx, line) {   // a comment that trails code on this exact line
  if (ctx.i < ctx.comments.length && ctx.comments[ctx.i].line === line && ctx.comments[ctx.i].trailing) {
    const c = ctx.comments[ctx.i++];
    return c.text ? '  # ' + c.text : '  #';
  }
  return '';
}

// A statement's LAST source line — its closing `}` for a block statement — so a comment trailing that line
// attaches to the whole statement, not to whatever inner statement happens to start on the same line.
function stmtEndLine(s) {
  const b = (s.elseBlock && s.elseBlock.endLine) || (s.catchBlock && s.catchBlock.endLine)
    || (s.body && s.body.endLine) || (s.thenBlock && s.thenBlock.endLine) || s.matchEnd;
  return b || s.line;
}

function formatProgram(ast, comments = []) {
  const ctx = newCtx(comments);
  let out = '';
  for (const s of ast.body) {
    out += ownLineComments(ctx, s.line, 0) + fmtStmt(s, 0, ctx) + trailingComment(ctx, stmtEndLine(s)) + '\n';
  }
  out += ownLineComments(ctx, Infinity, 0);   // footer / trailing comments after the last statement
  return out;
}

function fmtBlock(body, level, ctx = newCtx()) {
  const tail = body.endLine ? () => ownLineComments(ctx, body.endLine, level + 1).replace(/\n+$/, '') : () => '';
  if (!body.length) { const t = tail(); return t ? ' {\n' + t + '\n' + pad(level) + '}' : ' {}'; }
  const parts = body.map(s => ownLineComments(ctx, s.line, level + 1) + fmtStmt(s, level + 1, ctx) + trailingComment(ctx, stmtEndLine(s)));
  let inner = parts.join('\n');
  const t = tail();                       // comments after the last statement but before the closing brace stay INSIDE
  if (t) inner += '\n' + t;
  return ' {\n' + inner + '\n' + pad(level) + '}';
}

function fmtParams(params) {
  return '(' + params.map(p => {
    if (p.rest) return '...' + p.name;
    return p.name + (p.paramType ? ': ' + p.paramType : '') + (p.def != null ? ' = ' + fmtExpr(p.def) : '');
  }).join(', ') + ')';
}

function fmtNeed(item) {
  if (!item.limit) return item.name;
  const parts = [];
  if (Object.prototype.hasOwnProperty.call(item.limit, 'max')) parts.push('max ' + item.limit.max);
  if (Object.prototype.hasOwnProperty.call(item.limit, 'total')) parts.push('total ' + item.limit.total);
  return item.name + '(' + parts.join(', ') + ')';
}

function fmtStmt(s, level, ctx = newCtx()) {
  const p = pad(level);
  switch (s.type) {
    case 'Seed': return p + `seed ${s.name}${s.declType ? ': ' + s.declType : ''} = ${fmtExpr(s.value)}`;
    case 'SeedDestructure': return p + `seed ${fmtPattern(s.pattern)} = ${fmtExpr(s.value)}`;
    case 'Decay': return p + `decay ${fmtExpr(s.target)}`;
    case 'Emit': return p + 'emit ' + s.args.map(a => fmtExpr(a)).join(', ');
    case 'When': {
      let out = p + `when ${fmtExpr(s.cond)}` + fmtBlock(s.thenBlock, level, ctx);
      if (s.elseBlock) {
        if (s.elseBlock.length === 1 && s.elseBlock[0].type === 'When') {
          out += ' otherwise ' + fmtStmt(s.elseBlock[0], 0, ctx);
        } else {
          out += ' otherwise' + fmtBlock(s.elseBlock, level, ctx);
        }
      }
      return out;
    }
    case 'Reinforce': return p + `reinforce ${fmtExpr(s.cond)}` + fmtBlock(s.body, level, ctx);
    case 'ReinforceTimes': return p + `reinforce ${fmtExpr(s.count)} times` + fmtBlock(s.body, level, ctx);
    case 'ForEach': return p + `for each ${s.varName} in ${fmtExpr(s.iterable)}` + fmtBlock(s.body, level, ctx);
    case 'Agent': return p + `agent ${s.name}${fmtParams(s.params)}${s.returnType ? ': ' + s.returnType : ''}` + fmtBlock(s.body, level, ctx);
    case 'Report': return p + (s.value && s.value.type !== 'Void' ? 'report ' + fmtExpr(s.value) : 'report');
    case 'Attempt': return p + 'attempt' + fmtBlock(s.tryBlock, level, ctx) + ` rescue ${s.errName}` + fmtBlock(s.catchBlock, level, ctx);
    case 'Fail': {
      const isDefault = s.value && s.value.type === 'String' && s.value.value === 'failed';
      return p + (isDefault ? 'fail' : 'fail ' + fmtExpr(s.value));
    }
    case 'Weave': return p + 'weave ' + fmtExpr(s.path) + (s.alias ? ` as ${s.alias}` : '');
    case 'Expose': return p + `expose ${s.name}`;
    case 'Needs': return p + 'needs ' + s.items.map(fmtNeed).join(', ');
    case 'Assign': return p + `${fmtExpr(s.target)} = ${fmtExpr(s.value)}`;
    case 'Test': return p + `test ${q(s.name)}` + fmtBlock(s.body, level, ctx);
    case 'Expect': return p + 'expect ' + fmtMatcher(s);
    case 'Match': {
      if (!s.arms.length) return p + `match ${fmtExpr(s.subject)} {}`;
      const arms = s.arms.map(a => pad(level + 1) + fmtPattern(a.pattern) + fmtBlock(a.body, level + 1, ctx)).join('\n');
      return p + `match ${fmtExpr(s.subject)} {\n${arms}\n${pad(level)}}`;
    }
    case 'Give': return p + `give ${fmtExpr(s.value)} to ${fmtExpr(s.channel)}`;
    case 'Take': return p + `take ${s.name} from ${fmtExpr(s.channel)}`;
    case 'Yield': return p + 'yield';
    case 'ExpressionStatement': return p + fmtExpr(s.expr);
    default: throw new Error(`cannot format statement type ${s.type}`);
  }
}

function fmtMatcher(s) {
  const a = fmtExpr(s.actual);
  const m = s.matcher;
  switch (m.kind) {
    case 'is': return `${a} is ${fmtExpr(m.expected)}`;
    case 'isnot': return `${a} is not ${fmtExpr(m.expected)}`;
    case 'fail': return `${a} to fail`;
    case 'failwith': return `${a} to fail with ${fmtExpr(m.expected)}`;
    default: return a;   // truthy
  }
}

function fmtPattern(pp) {
  switch (pp.type) {
    case 'PWild': return '_';
    case 'PBind': return pp.name;
    case 'PLit': return fmtExpr(pp.expr);
    case 'PList': {
      const parts = pp.elements.map(fmtPattern);
      if (pp.rest) parts.push('...' + pp.rest);
      return '[' + parts.join(', ') + ']';
    }
    case 'PMesh': return pp.pairs.length ? '{ ' + pp.pairs.map(pr =>
      (pr.pattern.type === 'PBind' && pr.pattern.name === pr.key) ? pr.key : `${q(pr.key)}: ${fmtPattern(pr.pattern)}`
    ).join(', ') + ' }' : '{}';
    default: throw new Error(`cannot format pattern ${pp.type}`);
  }
}

function exprPrec(e) {
  if (e.type === 'Pipe') return 0;
  if (e.type === 'Binary') return PREC[e.op] || 0;
  if (e.type === 'Unary') return 7;
  if (e.type === 'Call' || e.type === 'Index') return 9;
  return 10;
}

function par(s, need) { return need ? '(' + s + ')' : s; }

function fmtExpr(e, parent = 0, side = '') {
  switch (e.type) {
    case 'Number': return String(e.value);
    case 'String': return q(e.value);
    case 'Bool': return e.value ? 'live' : 'dead';
    case 'Void': return 'void';
    case 'Identifier': return e.name;
    case 'Interp':
      return '"' + e.parts.map(part => part.type === 'String'
        ? String(part.value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/{/g, '\\{')
        : '{' + fmtExpr(part) + '}').join('') + '"';
    case 'Unary': {
      const mine = exprPrec(e);
      const out = e.op === 'not' ? `not ${fmtExpr(e.operand, mine)}` : '-' + fmtExpr(e.operand, mine);
      return par(out, mine < parent);
    }
    case 'Binary': {
      const mine = exprPrec(e);
      const left = fmtExpr(e.left, mine, 'left');
      const right = fmtExpr(e.right, mine + (['-', '/', '%'].includes(e.op) ? 1 : 0), 'right');
      return par(`${left} ${e.op} ${right}`, mine < parent || (mine === parent && side === 'right'));
    }
    case 'Pipe': return par(`${fmtExpr(e.left, 0)} | ${fmtExpr(e.right, 1)}`, parent > 0);
    case 'Call': return fmtExpr(e.callee, 9) + '(' + e.args.map(a => fmtExpr(a)).join(', ') + ')';
    case 'Index': return fmtExpr(e.object, 9) + '[' + fmtExpr(e.index) + ']';
    case 'List': return '[' + e.elements.map(x => fmtExpr(x)).join(', ') + ']';
    case 'Mesh': return e.pairs.length ? '{ ' + e.pairs.map(([k, v]) => `${fmtExpr(k)}: ${fmtExpr(v)}`).join(', ') + ' }' : '{}';
    case 'AgentExpr': return 'agent' + fmtParams(e.params) + (e.returnType ? ': ' + e.returnType : '') + fmtBlock(e.body, 0);
    case 'Dispatch': return 'dispatch ' + fmtExpr(e.call);
    case 'Gather': return 'gather ' + fmtExpr(e.expr, 8);
    case 'Spawn': return 'spawn ' + fmtExpr(e.call);
    default: throw new Error(`cannot format expression type ${e.type}`);
  }
}

module.exports = { formatSource, formatProgram };
