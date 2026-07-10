'use strict';
// parser.js — turns a token stream into an Abstract Syntax Tree (AST).
// Recursive descent for statements; precedence climbing for expressions.

const { tokenize } = require('./lexer');
const { MyxoError } = require('./errors');

// Binary operator precedence, low to high. Each level is parsed by folding
// the level above it. `and`/`or` are keywords; the rest are operator tokens.
const PRECEDENCE = [
  { match: t => t.type === 'KEYWORD' && t.value === 'or', ops: ['or'] },
  { match: t => t.type === 'KEYWORD' && t.value === 'and', ops: ['and'] },
  { match: t => t.type === 'EQ' || t.type === 'NE', ops: ['==', '!='] },
  { match: t => ['GT', 'LT', 'GE', 'LE'].includes(t.type), ops: ['>', '<', '>=', '<='] },
  { match: t => t.type === 'PLUS' || t.type === 'MINUS', ops: ['+', '-'] },
  { match: t => ['STAR', 'SLASH', 'PERCENT'].includes(t.type), ops: ['*', '/', '%'] },
];

// Gradual types: optional annotations from this set. `any` opts back into dynamic.
const VALID_TYPES = new Set(['number', 'string', 'bool', 'list', 'mesh', 'agent', 'void', 'any']);

class Parser {
  constructor(tokens) { this.tokens = tokens; this.pos = 0; }

  peek(o = 0) { return this.tokens[this.pos + o]; }
  next() { return this.tokens[this.pos++]; }
  atEnd() { return this.peek().type === 'EOF'; }

  isKeyword(word) {
    const t = this.peek();
    return t.type === 'KEYWORD' && t.value === word;
  }

  expect(type, what) {
    const t = this.peek();
    if (t.type !== type) {
      throw new MyxoError(`expected ${what || type} but found '${t.value ?? t.type}'`, t.line, t.col);
    }
    return this.next();
  }

  expectKeyword(word) {
    if (!this.isKeyword(word)) {
      const t = this.peek();
      throw new MyxoError(`expected '${word}' but found '${t.value ?? t.type}'`, t.line, t.col);
    }
    return this.next();
  }

  // A CONTEXTUAL word (a plain identifier used as a connector, e.g. `to`/`from` in send/recv) — not reserved,
  // so it stays usable as an ordinary variable name everywhere else.
  expectWord(word) {
    const t = this.peek();
    if (t.type !== 'IDENT' || t.value !== word) {
      throw new MyxoError(`expected '${word}' but found '${t.value ?? t.type}'`, t.line, t.col);
    }
    return this.next();
  }

  // ---- statements ---------------------------------------------------------

  parseProgram() {
    const body = [];
    while (!this.atEnd()) body.push(this.parseStatement());
    return { type: 'Program', body };
  }

  parseBlock() {
    this.expect('LBRACE', '{');
    const body = [];
    while (this.peek().type !== 'RBRACE' && !this.atEnd()) body.push(this.parseStatement());
    const close = this.expect('RBRACE', '}');
    body.endLine = close.line;   // the `}` line, so the formatter can keep block-tail comments inside the block
    return body;
  }

  parseStatement() {
    const t = this.peek();
    if (t.type === 'KEYWORD') {
      switch (t.value) {
        case 'seed': return this.parseSeed();
        case 'decay': return this.parseDecay();
        case 'emit': return this.parseEmit();
        case 'when': return this.parseWhen();
        case 'reinforce': return this.parseReinforce();
        case 'for': return this.parseForEach();
        case 'report': return this.parseReport();
        case 'attempt': return this.parseAttempt();
        case 'fail': return this.parseFail();
        case 'weave': return this.parseWeave();
        case 'expose': return this.parseExpose();
        case 'needs': return this.parseNeeds();
        case 'test': return this.parseTest();
        case 'expect': return this.parseExpect();
        case 'match': return this.parseMatch();
        case 'give': return this.parseGive();
        case 'take': return this.parseTake();
        case 'yield': { const kw = this.next(); return { type: 'Yield', line: kw.line }; }
        case 'rescue':
          throw new MyxoError("'rescue' without a matching 'attempt'", t.line, t.col);
        case 'as':
          throw new MyxoError("'as' only follows a 'weave' path", t.line, t.col);
        case 'agent':
          // `agent name(...)` is a declaration; `agent(...)` is an expression.
          if (this.peek(1).type === 'IDENT') return this.parseAgentDecl();
          break;
        case 'otherwise':
          throw new MyxoError("'otherwise' without a matching 'when'", t.line, t.col);
      }
    }
    return this.parseExpressionStatement();
  }

  parseSeed() {
    const kw = this.expectKeyword('seed');
    const t = this.peek();
    // Destructuring: `seed [a, ...rest] = xs` / `seed { a, b } = m` — bind many names from a list/mesh at once.
    if (t.type === 'LBRACKET' || t.type === 'LBRACE') {
      const pattern = t.type === 'LBRACKET' ? this.parseListPattern() : this.parseMeshPattern();
      this.assertLinear(pattern, new Set(), kw.line);
      this.expect('ASSIGN', '=');
      const value = this.parseExpression();
      return { type: 'SeedDestructure', pattern, value, line: kw.line };
    }
    const name = this.expect('IDENT', 'a name').value;
    let declType = null;
    if (this.peek().type === 'COLON') { this.next(); declType = this.parseType(); }   // seed n: number = 5
    this.expect('ASSIGN', '=');
    const value = this.parseExpression();
    return { type: 'Seed', name, value, declType, line: kw.line };
  }

  // An optional gradual-type annotation: number/string/bool/list/mesh/agent/void/any.
  parseType() {
    const t = this.peek();
    let name;
    if (t.type === 'KEYWORD' && (t.value === 'void' || t.value === 'agent')) { this.next(); name = t.value; }  // void/agent are keywords AND type names
    else if (t.type === 'IDENT') { this.next(); name = t.value; }
    else {
      const hint = (t.type === 'STRING' || t.type === 'NUMBER') ? " — parameter defaults now use '=' (name = default), not ':'" : '';
      throw new MyxoError(`expected a type name, got '${t.value ?? t.type}'${hint}`, t.line, t.col);
    }
    if (!VALID_TYPES.has(name)) throw new MyxoError(`unknown type '${name}' — use number/string/bool/list/mesh/agent/void/any`, t.line, t.col);
    return name;
  }

  parseDecay() {
    const kw = this.expectKeyword('decay');
    const target = this.parseExpression();
    if (target.type !== 'Identifier' && target.type !== 'Index') {
      throw new MyxoError('can only decay a pathway or an indexed slot', kw.line, kw.col);
    }
    return { type: 'Decay', target, line: kw.line };
  }

  parseEmit() {
    const kw = this.expectKeyword('emit');
    const args = [this.parseExpression()];
    while (this.peek().type === 'COMMA') { this.next(); args.push(this.parseExpression()); }
    return { type: 'Emit', args, line: kw.line };
  }

  parseWhen() {
    const kw = this.expectKeyword('when');
    const cond = this.parseExpression();
    const thenBlock = this.parseBlock();
    let elseBlock = null;
    if (this.isKeyword('otherwise')) {
      this.next();
      // `otherwise when ...` chains; otherwise a plain block.
      elseBlock = this.isKeyword('when') ? [this.parseWhen()] : this.parseBlock();
    }
    return { type: 'When', cond, thenBlock, elseBlock, line: kw.line };
  }

  parseReinforce() {
    const kw = this.expectKeyword('reinforce');
    const expr = this.parseExpression();
    if (this.isKeyword('times')) {
      this.next();
      const body = this.parseBlock();
      return { type: 'ReinforceTimes', count: expr, body, line: kw.line };
    }
    const body = this.parseBlock();
    return { type: 'Reinforce', cond: expr, body, line: kw.line };
  }

  parseForEach() {
    const kw = this.expectKeyword('for');
    this.expectKeyword('each');
    const varName = this.expect('IDENT', 'a name').value;
    this.expectKeyword('in');
    const iterable = this.parseExpression();
    const body = this.parseBlock();
    return { type: 'ForEach', varName, iterable, body, line: kw.line };
  }

  parseAgentDecl() {
    const kw = this.expectKeyword('agent');
    const name = this.expect('IDENT', 'an agent name').value;
    const params = this.parseParams();
    let returnType = null;
    if (this.peek().type === 'COLON') { this.next(); returnType = this.parseType(); }   // agent f(x): number { }
    const body = this.parseBlock();
    return { type: 'Agent', name, params, body, returnType, line: kw.line };
  }

  parseReport() {
    const kw = this.expectKeyword('report');
    // `report` may stand alone (reports void) or carry a value.
    const ends = this.peek().type === 'RBRACE' || this.atEnd();
    const value = ends ? { type: 'Void' } : this.parseExpression();
    return { type: 'Report', value, line: kw.line };
  }

  // attempt { ... } rescue err { ... } — run a block; if a pathway fails, the
  // failure is caught and bound to `err` (a mesh: message, line, value).
  parseAttempt() {
    const kw = this.expectKeyword('attempt');
    const tryBlock = this.parseBlock();
    this.expectKeyword('rescue');
    const errName = this.expect('IDENT', 'a name for the failure').value;
    const catchBlock = this.parseBlock();
    return { type: 'Attempt', tryBlock, errName, catchBlock, line: kw.line };
  }

  // fail expr — raise a failure that an enclosing `attempt` can rescue.
  parseFail() {
    const kw = this.expectKeyword('fail');
    const ends = this.peek().type === 'RBRACE' || this.atEnd();
    const value = ends ? { type: 'String', value: 'failed' } : this.parseExpression();
    return { type: 'Fail', value, line: kw.line };
  }

  // weave "path" [as alias] — import a strand. Flat by default; `as` namespaces
  // the exposed names into a mesh you index with ["name"].
  parseWeave() {
    const kw = this.expectKeyword('weave');
    const path = this.parseExpression();
    let alias = null;
    if (this.isKeyword('as')) { this.next(); alias = this.expect('IDENT', 'an alias name').value; }
    return { type: 'Weave', path, alias, line: kw.line };
  }

  // expose name — mark a pathway public so weaving strands can import it.
  parseExpose() {
    const kw = this.expectKeyword('expose');
    const name = this.expect('IDENT', 'a name to expose').value;
    return { type: 'Expose', name, line: kw.line };
  }

  // needs cap, cap(max N), ... — declare the host capabilities this script may
  // call. Once declared, calling an undeclared capability is refused; an optional
  // `(max N)` caps the capability's first argument, runtime-enforced and logged.
  parseNeeds() {
    const kw = this.expectKeyword('needs');
    const items = [this.parseNeedItem()];
    while (this.peek().type === 'COMMA') { this.next(); items.push(this.parseNeedItem()); }
    return { type: 'Needs', items, line: kw.line };
  }

  parseNeedItem() {
    const name = this.expect('IDENT', 'a capability name').value;
    let limit = null;
    if (this.peek().type === 'LPAREN') {
      this.next();
      limit = {};
      this.parseConstraint(limit);
      while (this.peek().type === 'COMMA') { this.next(); this.parseConstraint(limit); }
      this.expect('RPAREN', "')' to close the constraint");
    }
    return { name, limit };
  }

  // a single capability constraint: `max N` (per-call ceiling) or `total N`
  // (cumulative budget across the whole run). Folds into the limit object.
  parseConstraint(limit) {
    const kind = this.expect('IDENT', "a constraint like 'max' or 'total'").value;
    if (kind !== 'max' && kind !== 'total') {
      throw new MyxoError(`unknown capability constraint '${kind}' — use 'max' or 'total'`, this.peek().line);
    }
    limit[kind] = this.expect('NUMBER', 'a number for the cap').value;
  }

  // test "name" { ... } — a named test case. Its body runs only under `myxo test`
  // (inert in a normal run), and `expect` assertions inside it are collected.
  parseTest() {
    const kw = this.expectKeyword('test');
    const t = this.peek();
    if (t.type !== 'STRING') throw new MyxoError('a test needs a name string: test "..." { }', t.line, t.col);
    this.next();
    const body = this.parseBlock();
    return { type: 'Test', name: t.value, body, line: kw.line };
  }

  // expect EXPR              — the value must be live (truthy)
  // expect EXPR is EXPR      — deep equality   (`is not` for inequality)
  // expect EXPR to fail      — evaluating EXPR must raise an Myxo failure
  // expect EXPR to fail with STRING — ...and its message must contain STRING
  // `is` / `to` / `with` are contextual here, not reserved words.
  parseExpect() {
    const kw = this.expectKeyword('expect');
    const actual = this.parseExpression();
    let matcher = { kind: 'truthy' };
    const t = this.peek(), nx = this.peek(1);
    // `is`/`to` are contextual: only treat them as matcher words when they actually start one, so a bare
    // `expect X` followed by a statement that happens to begin with a var named `is`/`to` doesn't merge.
    if (t.type === 'IDENT' && t.value === 'is' && nx.type !== 'ASSIGN') {
      this.next();
      if (this.isKeyword('not')) { this.next(); matcher = { kind: 'isnot', expected: this.parseExpression() }; }
      else matcher = { kind: 'is', expected: this.parseExpression() };
    } else if (t.type === 'IDENT' && t.value === 'to' && nx.type === 'KEYWORD' && nx.value === 'fail') {
      this.next();
      this.expectKeyword('fail');
      if (this.peek().type === 'IDENT' && this.peek().value === 'with') {
        this.next();
        matcher = { kind: 'failwith', expected: this.parseExpression() };
      } else {
        matcher = { kind: 'fail' };
      }
    }
    return { type: 'Expect', actual, matcher, line: kw.line };
  }

  // match SUBJECT { PATTERN { ... } ... } — run the first arm whose pattern matches, binding the
  // pattern's names. If no arm matches, nothing runs (use `_` for a catch-all).
  // `give VALUE to CHANNEL` and `take NAME from CHANNEL` — cooperative channel ops (suspension points in a fiber).
  parseGive() {
    const kw = this.expectKeyword('give');
    const value = this.parseExpression();
    this.expectWord('to');
    const channel = this.parseExpression();
    return { type: 'Give', value, channel, line: kw.line };
  }
  parseTake() {
    const kw = this.expectKeyword('take');
    const name = this.expect('IDENT', 'a name to bind the taken value').value;
    this.expectWord('from');
    const channel = this.parseExpression();
    return { type: 'Take', name, channel, line: kw.line };
  }

  parseMatch() {
    const kw = this.expectKeyword('match');
    const subject = this.parseExpression();
    this.expect('LBRACE', '{');
    const arms = [];
    while (this.peek().type !== 'RBRACE' && !this.atEnd()) {
      const armLine = this.peek().line;
      const pattern = this.parsePattern();
      this.assertLinear(pattern, new Set(), armLine);
      const body = this.parseBlock();
      arms.push({ pattern, body });
    }
    const close = this.expect('RBRACE', "'}' to close the match");
    return { type: 'Match', subject, arms, line: kw.line, matchEnd: close.line };
  }

  // Patterns are LINEAR: a name may bind at most once per arm. Myxo has no non-linear/equality patterns,
  // so `[x, x]` is a mistake — reject it instead of silently last-winning the second binding.
  assertLinear(pat, seen, line) {
    switch (pat.type) {
      case 'PBind':
        if (seen.has(pat.name)) throw new MyxoError(`pattern binds '${pat.name}' more than once`, line);
        seen.add(pat.name); return;
      case 'PList':
        for (const e of pat.elements) this.assertLinear(e, seen, line);
        if (pat.rest) {
          if (seen.has(pat.rest)) throw new MyxoError(`pattern binds '${pat.rest}' more than once`, line);
          seen.add(pat.rest);
        }
        return;
      case 'PMesh':
        for (const pr of pat.pairs) this.assertLinear(pr.pattern, seen, line);
        return;
      default: return;   // PWild / PLit bind nothing
    }
  }

  // A pattern: `_` (wildcard), a name (binds the value), a literal, `[p, ..., ...rest]`, or `{ "key": p }`.
  parsePattern() {
    const t = this.peek();
    if (t.type === 'IDENT') { this.next(); return t.value === '_' ? { type: 'PWild' } : { type: 'PBind', name: t.value }; }
    if (t.type === 'NUMBER') { this.next(); return { type: 'PLit', expr: { type: 'Number', value: t.value } }; }
    if (t.type === 'STRING') { this.next(); return { type: 'PLit', expr: { type: 'String', value: t.value } }; }
    if (t.type === 'MINUS') { this.next(); const n = this.expect('NUMBER', 'a number after -'); return { type: 'PLit', expr: { type: 'Number', value: -n.value } }; }
    if (t.type === 'KEYWORD') {
      if (t.value === 'live') { this.next(); return { type: 'PLit', expr: { type: 'Bool', value: true } }; }
      if (t.value === 'dead') { this.next(); return { type: 'PLit', expr: { type: 'Bool', value: false } }; }
      if (t.value === 'void') { this.next(); return { type: 'PLit', expr: { type: 'Void' } }; }
    }
    if (t.type === 'LBRACKET') return this.parseListPattern();
    if (t.type === 'LBRACE') return this.parseMeshPattern();
    throw new MyxoError(`bad pattern: unexpected '${t.value ?? t.type}'`, t.line, t.col);
  }

  parseListPattern() {
    this.expect('LBRACKET', '[');
    const elements = [];
    let rest = null;
    while (this.peek().type !== 'RBRACKET') {
      if (this.peek().type === 'ELLIPSIS') {
        this.next();
        rest = this.expect('IDENT', 'a name after ...').value;
        break;   // ...rest must be last
      }
      elements.push(this.parsePattern());
      if (this.peek().type === 'COMMA') { this.next(); continue; }
      break;
    }
    this.expect('RBRACKET', "']' to close the list pattern");
    return { type: 'PList', elements, rest };
  }

  parseMeshPattern() {
    this.expect('LBRACE', '{');
    const pairs = [];
    while (this.peek().type !== 'RBRACE') {
      const t = this.peek();
      if (t.type === 'STRING') {                 // explicit:  "key": pattern
        this.next();
        this.expect('COLON', ':');
        pairs.push({ key: t.value, pattern: this.parsePattern() });
      } else if (t.type === 'IDENT') {           // shorthand:  { name }  ==  { "name": name }
        this.next();
        if (this.peek().type === 'COLON') throw new MyxoError(`mesh pattern keys are strings — write "${t.value}": pattern, or just ${t.value} to bind`, t.line, t.col);
        pairs.push({ key: t.value, pattern: { type: 'PBind', name: t.value } });
      } else {
        throw new MyxoError(`a mesh pattern key must be a "string" or a name, got '${t.value ?? t.type}'`, t.line, t.col);
      }
      if (this.peek().type === 'COMMA') { this.next(); continue; }
      break;
    }
    this.expect('RBRACE', "'}' to close the mesh pattern");
    return { type: 'PMesh', pairs };
  }

  parseExpressionStatement() {
    const line = this.peek().line;
    const expr = this.parseExpression();
    if (this.peek().type === 'ASSIGN') {
      this.next();
      if (expr.type !== 'Identifier' && expr.type !== 'Index') {
        throw new MyxoError('can only assign to a pathway or an indexed slot', line);
      }
      const value = this.parseExpression();
      return { type: 'Assign', target: expr, value, line };
    }
    return { type: 'ExpressionStatement', expr, line };
  }

  parseParams() {
    this.expect('LPAREN', '(');
    const params = [];
    if (this.peek().type !== 'RPAREN') {
      params.push(this.parseParam());
      while (this.peek().type === 'COMMA') { this.next(); params.push(this.parseParam()); }
    }
    this.expect('RPAREN', ')');
    return params;
  }

  // one parameter: `name`, `name: Type`, `name = default`, `name: Type = default`, or `...rest`.
  parseParam() {
    if (this.peek().type === 'ELLIPSIS') {
      this.next();
      const name = this.expect('IDENT', 'a rest-parameter name').value;
      return { name, def: null, rest: true, paramType: null };
    }
    const name = this.expect('IDENT', 'a parameter name').value;
    let paramType = null, def = null;
    if (this.peek().type === 'COLON') { this.next(); paramType = this.parseType(); }       // : Type
    if (this.peek().type === 'ASSIGN') { this.next(); def = this.parseExpression(); }       // = default
    return { name, def, rest: false, paramType };
  }

  // ---- expressions --------------------------------------------------------

  parseExpression() { return this.parsePipe(); }

  // Pipelines: `x | f | g(a)` reads top-to-bottom. `x | f` is `f(x)`; `x | f(a)` is `f(x, a)`
  // (the piped value becomes the FIRST argument). Lowest precedence, left-associative.
  parsePipe() {
    let left = this.parseBinary(0);
    while (this.peek().type === 'PIPE') {
      const t = this.next();
      const right = this.parseBinary(0);
      left = { type: 'Pipe', left, right, line: t.line };
    }
    return left;
  }

  parseBinary(level) {
    if (level >= PRECEDENCE.length) return this.parseUnary();
    let left = this.parseBinary(level + 1);
    const rule = PRECEDENCE[level];
    while (rule.match(this.peek())) {
      const opTok = this.next();
      const op = opTok.value;
      const right = this.parseBinary(level + 1);
      left = { type: 'Binary', op, left, right, line: opTok.line };
    }
    return left;
  }

  parseUnary() {
    const t = this.peek();
    if (this.isKeyword('not')) { this.next(); return { type: 'Unary', op: 'not', operand: this.parseUnary(), line: t.line }; }
    if (t.type === 'MINUS') { this.next(); return { type: 'Unary', op: '-', operand: this.parseUnary(), line: t.line }; }
    // Concurrency: `dispatch f(x)` builds an unstarted task; `gather [t1, t2]` runs them in parallel.
    if (this.isKeyword('dispatch')) {
      this.next();
      const call = this.parsePostfix();
      if (!call || call.type !== 'Call') {
        throw new MyxoError("dispatch needs an agent call, e.g. dispatch work(x)", t.line, t.col);
      }
      return { type: 'Dispatch', call, line: t.line };
    }
    if (this.isKeyword('gather')) {
      this.next();
      return { type: 'Gather', expr: this.parseUnary(), line: t.line };
    }
    // Cooperative concurrency: `spawn f(x)` starts a fiber and returns its handle.
    if (this.isKeyword('spawn')) {
      this.next();
      const call = this.parsePostfix();
      if (!call || call.type !== 'Call') {
        throw new MyxoError("spawn needs an agent call, e.g. spawn worker(ch)", t.line, t.col);
      }
      return { type: 'Spawn', call, line: t.line };
    }
    return this.parsePostfix();
  }

  // Calls and indexing bind tighter than anything and chain left-to-right.
  parsePostfix() {
    let expr = this.parsePrimary();
    for (;;) {
      const t = this.peek();
      if (t.type === 'LPAREN') {
        this.next();
        const args = [];
        if (this.peek().type !== 'RPAREN') {
          args.push(this.parseExpression());
          while (this.peek().type === 'COMMA') { this.next(); args.push(this.parseExpression()); }
        }
        this.expect('RPAREN', ')');
        expr = { type: 'Call', callee: expr, args, line: t.line };
      } else if (t.type === 'LBRACKET') {
        this.next();
        const index = this.parseExpression();
        this.expect('RBRACKET', ']');
        expr = { type: 'Index', object: expr, index, line: t.line };
      } else {
        return expr;
      }
    }
  }

  parsePrimary() {
    const t = this.peek();

    if (t.type === 'NUMBER') { this.next(); return { type: 'Number', value: t.value }; }
    if (t.type === 'STRING') { this.next(); return { type: 'String', value: t.value }; }
    if (t.type === 'TEMPLATE') {
      this.next();
      const parts = t.value.map(seg => seg.t === 'lit'
        ? { type: 'String', value: seg.v }
        : parseFragment(seg.v, t.line));
      return { type: 'Interp', parts, line: t.line };
    }
    if (t.type === 'IDENT') { this.next(); return { type: 'Identifier', name: t.value, line: t.line }; }

    if (t.type === 'KEYWORD') {
      if (t.value === 'live') { this.next(); return { type: 'Bool', value: true }; }
      if (t.value === 'dead') { this.next(); return { type: 'Bool', value: false }; }
      if (t.value === 'void') { this.next(); return { type: 'Void' }; }
      if (t.value === 'agent') return this.parseAgentExpr();
    }

    if (t.type === 'LPAREN') {
      this.next();
      const expr = this.parseExpression();
      this.expect('RPAREN', ')');
      return expr;
    }

    if (t.type === 'LBRACKET') return this.parseList();
    if (t.type === 'LBRACE') return this.parseMesh();

    throw new MyxoError(`unexpected '${t.value ?? t.type}'`, t.line, t.col);
  }

  parseAgentExpr() {
    const kw = this.expectKeyword('agent');
    const params = this.parseParams();
    let returnType = null;
    if (this.peek().type === 'COLON') { this.next(); returnType = this.parseType(); }
    const body = this.parseBlock();
    return { type: 'AgentExpr', params, body, returnType, line: kw.line };
  }

  parseList() {
    const open = this.expect('LBRACKET', '[');
    const elements = [];
    if (this.peek().type !== 'RBRACKET') {
      elements.push(this.parseExpression());
      while (this.peek().type === 'COMMA') {
        this.next();
        if (this.peek().type === 'RBRACKET') break; // trailing comma
        elements.push(this.parseExpression());
      }
    }
    this.expect('RBRACKET', ']');
    return { type: 'List', elements, line: open.line };
  }

  parseMesh() {
    const open = this.expect('LBRACE', '{');
    const pairs = [];
    if (this.peek().type !== 'RBRACE') {
      pairs.push(this.parsePair());
      while (this.peek().type === 'COMMA') {
        this.next();
        if (this.peek().type === 'RBRACE') break; // trailing comma
        pairs.push(this.parsePair());
      }
    }
    this.expect('RBRACE', '}');
    return { type: 'Mesh', pairs, line: open.line };
  }

  parsePair() {
    const key = this.parseExpression();
    this.expect('COLON', ':');
    const value = this.parseExpression();
    return [key, value];
  }
}

// Parse a raw expression fragment (a {…} interpolation chunk) into one AST node.
function parseFragment(src, line) {
  const p = new Parser(tokenize(src));
  const expr = p.parseExpression();
  if (!p.atEnd()) throw new MyxoError(`bad expression in interpolation: '${src}'`, line);
  offsetLines(expr, line - 1);   // fragment tokens count from line 1 — shift them onto the template's real source line
  return expr;
}
// Shift every node's source line by delta (so an interpolated expression reports the line it actually appears on).
function offsetLines(node, delta) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) offsetLines(n, delta); return; }
  if (typeof node.line === 'number') node.line += delta;
  for (const k of Object.keys(node)) { if (k !== 'line') offsetLines(node[k], delta); }
}

function parse(src) {
  const tokens = typeof src === 'string' ? tokenize(src) : src;
  return new Parser(tokens).parseProgram();
}

module.exports = { parse, Parser };
