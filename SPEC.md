# Myxo Language Specification (v1.5)

The precise, honest reference for Myxo. Where this spec and the implementation disagree, that is a bug in one of them — file it. Scope notes mark, in plain language, what Myxo does **not** do, so nothing here oversells.

Myxo is a small, embeddable, dynamically-typed language whose runtime *is* the Nexus law: useful pathways reinforce, useless ones decay. Reference implementation: a zero-dependency tree-walking interpreter in Node (`C:\Users\Milton\myxo\`).

---

## 1. Lexical structure

- **Encoding:** UTF-8 source text. **Newlines are insignificant** (whitespace only); statements are not terminated by `;` or newlines — they end where the grammar says they end. ⚠️ Because of this, a line that begins with `(`, `[`, or `-` can glue onto the previous line (`x` ⏎ `-3` parses as `x - 3`; `f` ⏎ `(a)` as `f(a)`).
- **Comments:** `#` to end of line.
- **Numbers:** `123`, `1.5`. All numbers are IEEE-754 float64 (no integer type, no bigint — an integer above 2^53 loses precision).
- **Strings:** `"..."` double-quoted. Escapes: `\n \t \" \\ \{ \}` (an unrecognized escape drops the backslash: `\z` → `z`). **Interpolation:** `"x is {expr}"` — `{...}` holds any expression; `\{` is a literal brace. Nested strings inside interpolations are allowed.
- **Identifiers:** `[A-Za-z_][A-Za-z0-9_]*`.
- **Keywords** (reserved): `seed decay emit when otherwise reinforce times for each in agent report attempt rescue fail weave expose as needs live dead void and or not test expect match`.
- **Operators / punctuation:** `+ - * / %  == != > < >= <=  = ( ) { } [ ] , : | ...`
- **Type names** (contextual, only after `:` in an annotation): `number string bool list mesh agent void any` — not globally reserved.

---

## 2. Values & types

Eight value kinds: **number**, **string**, **bool** (`live`/`dead`), **void**, **list**, **mesh** (insertion-ordered map; **keys are coerced to strings** — `1` and `"1"` are the same key, and numeric keys don't round-trip as numbers), **agent** (closure), **native** (a host function; appears as an `agent`-kind value to `type`).

- `void` is a single value; anything missing or unreported is `void`.
- **Truthiness** (`truthy`): `void`, `0`, `""`, the empty list `[]`, and the empty mesh `{}` are **dead**; everything else is **live**.
- **Equality** (`==`): `void` equals only `void`; different kinds are never equal; numbers/strings/bools compare by value; lists/meshes/agents compare by **identity** (not structure). (Structural equality exists only inside `match`/`expect`.)
- `type(v)` returns one of: `number string bool void list mesh agent`.

---

## 3. Expressions

Precedence, lowest → highest:

1. **`|` pipeline** (left-assoc): `x | f` ≡ `f(x)`; `x | f(a)` ≡ `f(x, a)` — the piped value is the **first** argument.
2. `or` 3. `and` 4. `== !=` 5. `> < >= <=` 6. `+ -` 7. `* / %` 8. unary `not` / `-` 9. call `f(...)` and index `x[i]` (left-assoc, tightest).

- **`and`/`or` return VALUES, not just bools:** `a and b` → `a` if `a` is dead, else `b`; `a or b` → `a` if `a` is live, else `b`. So `x or default` works. Both short-circuit.
- **Arithmetic** `- * / %` requires two numbers (else error); `/` and `%` by zero is an error. **`+`** adds two numbers, **concatenates if *either* operand is a string** (the other is `stringify`d, so `"x" + 1` → `"x1"`), and **concatenates two lists** (`[1,2] + [3]` → `[1,2,3]`).
- **Comparison** (`< > <= >=`) is defined for two numbers or two strings; anything else errors. `== !=` is defined for all values.
- **Indexing** `x[i]`: lists by integer (negative indexes count from the end: `a[0-1]` is the last); strings by integer → a one-character string; meshes by key. Out-of-range list read errors; a missing mesh key reads `void`.
- **List literal** `[a, b, ...]`, **mesh literal** `{ k: v, ... }` — mesh keys are **expressions** evaluated then **coerced to a string** (so `{ 1: "x" }` and `{ "1": "y" }` collide; a bare `{ a: 1 }` uses the *value* of pathway `a` as the key). Trailing commas allowed.
- **Agent expression** `agent(params) { body }` — an anonymous closure (see §5).
- Literals: `live`, `dead`, `void`, numbers, strings.

---

## 4. Statements

- **`seed name = expr`** — bind a pathway in the current scope. **`seed name: Type = expr`** — typed (see §11). Destructuring: **`seed [a, ...rest] = expr`** and **`seed { a, b } = expr`** / **`seed { "k": v } = expr`** (§9). Re-seeding rebinds.
- **`name = expr`** — reassign an existing pathway (errors if unseeded). **`x[i] = expr`** — set a list/mesh slot.
- **`decay name`** / **`decay x[i]`** — remove a pathway / slot.
- **`emit a, b, ...`** — print the space-joined `stringify` of the arguments + newline.
- **`when cond { ... }`** with optional **`otherwise { ... }`** or **`otherwise when ...`** (chained). Each block runs in a fresh child scope.
- **`reinforce cond { ... }`** — while-loop. **`reinforce N times { ... }`** — repeat N times.
- **`for each x in iterable { ... }`** — iterate a list (elements), a mesh (keys), or a string (characters).
- **`agent name(params) { body }`** — declare a named agent (§5). Optional return type: `agent name(params): Type { ... }`.
- **`report expr`** (or bare `report` → void) — return a value from the enclosing agent; at top level it ends the program with that value.
- **`attempt { ... } rescue err { ... }`** — run a block; a `fail`/runtime error is caught and bound to `err`, a mesh `{ message, line, value }`. **`fail expr`** raises (a string or any value).
- **`weave "path" [as alias]`** + **`expose name`** — modules (§7).
- **`needs ...`** — capability manifest (§6).
- **`match subject { pattern { ... } ... }`** — pattern matching (§8).
- **`test "name" { ... }`** + **`expect ...`** — the test runner (§10).
- Any expression alone is an expression-statement.

---

## 5. Agents (functions)

First-class lexical closures. **Parameters:** `name`, `name: Type`, `name = default`, `name: Type = default`, and a final `...rest` (gathers remaining args into a list). Defaults evaluate in call scope and may reference earlier parameters. Arity is checked (too few required / too many without `...rest` → error). `report` returns; falling off the end returns `void`. A recursion-depth guard (default 500) turns runaway recursion into a clean Myxo error; a runaway loop can be bounded by a `maxSteps` fuel option.

---

## 6. The capability fence (the moat)

The host grants natives via the embed API; an Myxo script reaches the outside world **only** through them. Enforced at every native call:

- **Manifest** — `needs lookup, notify` declares what the script may call. Calling an undeclared capability is **refused even if the host granted it**. With no `needs`, all granted natives are allowed (trusted top-level); a host may set `requireManifest` to demand a manifest first. A `weave`d strand's own `needs` merges into the **one program-wide** manifest — a module can widen the whole script's reach, so weave only trusted strands.
- **Value budgets** — `needs spend(max 5, total 15)`: `max` caps a single call's numeric first argument; `total` caps cumulative spend. For a non-numeric first argument, `total` counts **calls**. A negative/non-finite numeric budget argument is refused. Only successful calls count toward `total`.
- **Audit ledger** — every privileged call **and refusal** is recorded `{cap, args, ok, result|error}` and handed to the host (`onAudit`) even when the run fails.
- A capability denial carries an internal flag so a flow-router (§ below) propagates it rather than treating it as a transient failure.

**Honest boundary:** the fence governs *which* native a script may call, *how many times / how much*, and logs it — it does **not** sandbox the code *inside* a granted native (see polyglot, §12). For untrusted callers, grant only narrow, structured natives.

---

## 7. Modules

`weave "strand.myx"` loads a file once (cached, cycle-safe), importing its `expose`d names flatly; `weave "strand.myx" as m` namespaces them into a mesh `m["name"]`. Private by default. `weave` is itself fenced: a host that withholds the module loader disables it entirely.

---

## 8. Pattern matching (`match`)

`match subject { pattern { block } ... }` runs the first arm whose pattern matches, binding names in a fresh child scope. No arm matches → nothing runs (use `_` for a catch-all). Patterns:

- `_` wildcard (binds nothing); a bare `name` binds the whole value; a **literal** (`0`, `"s"`, `live`/`dead`/`void`, negative numbers) matches by structural equality.
- `[p, ..., ...rest]` — a list of exactly that length (or `>=` with `...rest`); elements matched recursively.
- `{ "key": pattern, ... }` — a mesh that **has** each key (a subset; extra keys are fine); `{ name }` is shorthand for `{ "name": name }`.

Patterns are **linear**: a name may bind at most once per arm (a repeated name is a parse error). The subject is evaluated once.

---

## 9. Pipelines & destructuring

- **Pipeline** `x | f` / `x | f(a)` — see §3 precedence. Pure sugar for a call; fully fenced/budgeted/audited/memoized like any call.
- **Destructuring** `seed PATTERN = expr` reuses the §8 patterns. A non-match is an error (no partial binding). Bindings are linear. Type-safe (a string does not match a list pattern).

---

## 10. The test runner (`myxo test`)

`test "name" { ... }` runs only under `myxo test` / `runTests` (inert in a normal run). Inside, `expect`:

- `expect e` — `e` must be live (an uncalled agent/native is rejected: "did you forget to call it?").
- `expect a is b` / `a is not b` — deep structural equality.
- `expect e to fail` / `to fail with "substr"` — `e` must raise an **intentional** failure (a `fail`, or a fence/budget denial); an incidental runtime error makes the test *error*, not pass.

A test with zero expectations, a `report` in its body, or a runtime error is a failure. `node myxo.js test <file|dir>` reports per-test, exits non-zero on any failure or if no tests ran. `myxo test` runs **strict** (§11) by default.

---

## 11. Gradual types

Optional annotations: `seed n: Type = v`, `agent f(x: Type = d, ...rest): Type`. Types: `number string bool list mesh agent void any` (`any` always matches). **Off by default** — a normal run ignores annotations and stays dynamic. Under **`--strict`** (and `myxo test`), annotations are enforced as **runtime contracts** at four boundaries: seed-init, parameter (at the call), return, and **reassignment** of a typed binding.

**Honest scope:** this is runtime contract-checking, **not** static type inference — no unions, no generics, no flow analysis. Containers are not element-typed (`list` means "any list"). Grammar: `:` introduces a type, `=` a default.

---

## 12. Polyglot bridge & flow-routing (library, not core syntax)

The **polyglot** verbs are host-installed natives, governed by the §6 fence; **`route`/`flows`** are core control-flow builtins (always present, **not** fenced themselves) — what the fence governs is the *providers* a router calls, when those are capabilities:

- **Polyglot** — `pycall`/`pyeval` (Python), `jscall`/`jseval` (Node), `plcall`/`pleval` (Perl) call functions/expressions in those runtimes (value-mapped JSON in/out); `bridgeExec` wraps any executable; `sh` runs a shell line. ⚠️ These are **arbitrary-code** verbs: granting one grants that runtime's full power — the fence bounds *which* verb and *how often*, not what the verb's code does.
- **Flow-routing** — `route(name, [providers])` returns a router that learns which interchangeable provider to use (conductance = an EWMA of recent success+speed; traffic ∝ conductance; instant failover; a fence denial propagates rather than rerouting). `flows(name)` shows conductances. It is exploit-leaning with hand-tuned constants; there is no automatic language-routing beyond this.

---

## 13. Concurrency: parallelism (`dispatch`/`gather`/`schedule`) & cooperation (fibers + channels)

`dispatch f(args…)` builds an **unstarted task** (a handle) capturing the agent and its evaluated arguments; nothing runs yet. `gather [t1, t2, …]` runs every task on its **own OS worker thread, in parallel**, blocks the calling thread until all finish, and returns their results **in dispatch order**. `gather` is an ordinary expression (its value is a list), so it composes (`gather ts | sum`, `seed [a, b] = gather […]`).

**Isolation is the safety model.** A dispatched task runs in a *fresh* interpreter: it sees the **stdlib**, **its own arguments**, and **itself** (recursion) — and nothing else. It cannot read or mutate the parent's pathways (a reach for one fails with `unknown pathway`), so there is no shared state to race on. Consequently arguments and results cross **by value** and must be plain **data** (`number`, `string`, `bool`, `list`, `mesh`, `void`); passing or returning code (an agent/native) is rejected at the boundary, and a **non-finite number** (NaN/Infinity) is rejected rather than silently nulled.

**Errors.** A task that `fail`s, throws, or errors at runtime surfaces promptly as a single `gather: <message>` (first error wins; all-or-nothing, like `Promise.all`). A true hard worker death (OOM/kill) is caught by a wall-clock timeout (default 30s). A `gather` is never memoized (spawning threads is an effect).

**Mechanism & limits.** Zero new dependencies — the same worker + `Atomics` + `SharedArrayBuffer` barrier as `myxo-live`; the interpreter runs at native speed inside a worker (measured). See `CONCURRENCY.md`. Limits, on purpose: one worker per task (no pool), self-contained agents only (no calls to *other* user agents from inside a task), and no inter-task channels — coordination is by structure (dispatch → gather), not message-passing. This is OS-thread parallelism, not cooperative coroutines.

**The Physarum scheduler.** `schedule(name, workers, items)` lifts `route` (the slime-mold selector, §12) to parallel batches: a **named, persistent pool** of interchangeable worker-agents (`worker(chunk) -> results`, batch in/out) over which a batch is distributed **proportional to conductance** (the same credit + explore-floor as `route`, with the credit persisted on the pool so trailing/recovered workers are still sampled across small batches), run on real worker threads **in parallel**, and reassembled at each item's original index. Each worker's conductance is updated from its **measured per-item speed** (EWMA, `quality = 1 + 8/(ms+1)`): fast workers pull more flux on later calls, a worker that errors decays and **its items reroute to the survivors** (single-tier failover; if all fail, `schedule` throws — never partial). `flows(name)` shows the learned conductances (for routers and pools alike). `schedule` is never memoized. The data boundary and isolation are exactly `gather`'s (items/results are plain data; no shared state — which is what makes the distribution race-free). Honest scope: adaptation is across calls (explore then exploit), timing is nondeterministic (the *invariants* — every item once, in order, faster-worker-ends-higher — are not), constants are hand-tuned and exploit-leaning. This is the living mesh applied to execution: the language becomes the scheduler.

**Cooperative concurrency (fibers + channels).** Where the above is *parallelism* (many OS threads), fibers are *concurrency* — many tasks interleaving on **one** thread, communicating through **channels**. `spawn f(args)` starts a fiber (returns a handle). `give VALUE to CHANNEL` sends; `take NAME from CHANNEL` receives, **parking** the fiber until a value is available (a `give` to a *full* bounded channel parks until space frees); `yield` reschedules cooperatively. `channel()` is unbounded, `channel(n)` bounded (backpressure). `await(fiber)` runs the scheduler and returns that fiber's reported value (re-raising its error); `drain()` runs all fibers; spawned-but-unawaited fibers also run at program end, and a fiber's error or a deadlock **always surfaces** (never silently dropped). Delivery is exactly-once, FIFO; the scheduler is single-threaded and **deterministic**. A channel is the only shared thing and the value moves hand to hand, so there is no shared mutable state to race on (and a channel is not data — it can't cross the `gather`/`dispatch` boundary). Honest scope: cooperative (not parallel); suspension composes through the fiber's own body and inside `when`/`match`/`for each`/`reinforce`/`attempt`, but **not** into a *called* agent's body (a clean error says so, not a silent failure); `await`/`drain` can't be called from inside a fiber; a runaway fiber is bounded by a step budget and errors rather than hangs; no `select`/timeouts/closeable channels yet. See `CONCURRENCY.md`.

---

## 14. The living mesh (runtime law)

Every pathway carries a strength; **reading reinforces it**. `strength(name)` introspects a **global** pathway's strength (a local/closure pathway reads `0`). A **hot, provably-pure** agent auto-**memoizes** — the runtime makes used paths faster, no keyword. Soundness: a result is cached only for a call proven pure — plain params; never tainted by a capability / `random` / `emit` / `weave` / a state-reading builtin / an outer write / a free *data* read (reading a free *agent* is exempt, for recursion); primitive args + result. A global **epoch** invalidates caches on any global write, **and on any reassignment or `decay` of an agent-valued binding** (this closes the one staleness the free-agent exemption would otherwise open). **`prune(threshold = 1)`** (returns the count reaped) and **`metabolize(threshold = 2)`** (returns a mesh `{reaped, count, promoted}`) are the decay verbs that sweep cold pathways — two distinct builtins, **not** aliases. There is **no** autonomous background GC.

---

## 15. Errors

One error type (`MyxoError`) carries a message, a source line, and — when it crossed agent calls — a stack trace (innermost first, truncated when deep). `attempt`/`rescue` catches Myxo errors (not internal control signals, not assertion failures). A raw JS stack overflow is converted to a clean Myxo error.

---

## 16. CLI & embedding

- **CLI:** `node myxo.js file.myx` (run) · `--trace` (print the mesh after) · `--strict` (enforce types) · `node myxo.js` (multi-line REPL) · `myxo fmt <file> [--check|--write|--drop-comments]` (AST formatter, one true style; **comments are preserved** — collected from the real lexer and re-attached by line, statement-granular; `--drop-comments` strips them) · `myxo test <file|dir>` · `myxo lsp` (stdio language server) · `myxo plan <file>` (capability preview — see below).
- **`myxo plan` (fence approval surface):** statically reports what host capabilities a script DECLARES (`needs`) vs what it REFERENCES, flagging referenced-but-undeclared (the fence would deny) and declared-but-unused (over-grant). Exit `0` clean / `1` not-clean / `2` couldn't analyze. It is a **best-effort preview, NOT a sound gate**: scope-aware over direct call-sites, but it cannot statically distinguish a host capability from a same-named user agent, nor follow a capability passed as a value / via `weave` — so it discloses these blind spots and defers to the **runtime fence** as the actual boundary. Use it to see intent and catch mistakes; never approve on it alone.
- **Embed:** `require('./myxo').run(src, opts)` and `runTests(src, opts)`. `opts`: `capture`, `output`, `natives` (host bridge), `mcp` (an MCP client → every tool becomes a fenced capability), `moduleLoader` (`null` fences `weave`), `dir`, `maxDepth`, `maxSteps`, `requireManifest`, `promoteAt` (memoization threshold; `1e9` disables), `strict`, `onAudit`. Production hosts: `myxo-run.js` (host allowlist) and `myxo-live.js` (sync-over-async worker bridge for async tools).

---

## 17. Not in v1.0 (honest)

Worker-thread parallelism (`dispatch`/`gather`/`schedule`) and cooperative concurrency (fibers + channels) both ship (§13). Still designed-but-not-built (see `VISION.md`): channel `select`/timeouts/closeable channels, suspension across called-agent boundaries, a thread-reuse worker **pool**, multi-tier failover, a bytecode VM / non-Node runtime, static type inference, element-typed containers, and a non-Node embedding wire. (`myxo fmt` now preserves comments, statement-granular — a comment trailing a one-line block or inside an inline `agent(){}` may shift to its own line, but none are dropped.) This spec describes only what ships today.
