# Nx — the language of the Nexus

**Nx 1.5** · a complete, from-scratch, **zero-dependency** language — its own parser, interpreter, stdlib, pattern matching, gradual types, real multi-core concurrency, a capability fence, tests, formatter, REPL, language server, and CLI.

A small, standalone and embeddable programming language whose runtime **is** the Nexus law:

> *Agents do not merge. Useful pathways reinforce. Useless pathways decay.*

That isn't a tagline bolted on top — it's the semantics. Functions are `agent`s.
Variables are *pathways* that gain strength each time they're read. You `decay` the ones
that go quiet, and `prune` sweeps the weak. Nx is written in plain Node with **zero
dependencies**, so it runs by itself from the CLI, runs anywhere the Nexus runs, and embeds
inside any Node program.

Nx is not just glue over Python, C++, or JAMES. Today it is a standalone `.nx` language
implemented in Node, with its own syntax, parser, interpreter, stdlib, tests, module rules,
formatter, REPL, and CLI. Its independence is semantic and operational: a `.nx` program can
run without Python, C++, JAMES, or MCP. Python, Node, Perl, shell, MCP tools, and compiled
binaries are foreign capabilities Nx can call through the same outer fence and audit ledger.
See [`INDEPENDENCE.md`](INDEPENDENCE.md) and [`HOW_IT_WORKS.md`](HOW_IT_WORKS.md).

```nx
agent fib(n) {
  when n < 2 { report n }
  report fib(n - 1) + fib(n - 2)
}

seed i = 0
reinforce i < 10 {
  emit fib(i)
  i = i + 1
}
```

## Run it

```
node nx.js examples/fib.nx          # run a file
node nx.js examples/the-law.nx --trace   # run, then print the living mesh
node nx.js                          # multi-line REPL (type an agent across lines)
npm test                            # full suite; optional runtimes are skipped if absent
npm run test:core                   # core language + formatter + MCP framing
npm run test:polyglot               # Python/Node/Perl bridge checks
npm run test:nx                     # Nx testing ITSELF, in Nx
node nx.js test tests/             # run .nx test files (test "..." { expect X is Y / to fail })
node nx.js fmt examples/fib.nx      # print canonical parser-backed Nx formatting
node nx.js fmt file.nx --check      # fail if file is not formatted
node nx.js fmt file.nx --write      # rewrite in place (comments preserved; --drop-comments to strip)
```

`nx fmt` is a canonical AST printer that **preserves comments** — it collects them from the real lexer and
re-attaches them by line (statement-granular: a comment trailing a one-line block or inside an inline
`agent(){}` may shift to its own line, but none are dropped or fabricated). `--drop-comments` strips them.

## The words

Nx keeps the building blocks but names them after the Nexus.

| You mean…            | Nx              | Example                                  |
|----------------------|-----------------|------------------------------------------|
| declare a value      | `seed`          | `seed power = 9`                         |
| change a value       | `name = ...`    | `power = power + 1`                       |
| remove a value       | `decay`         | `decay power`                            |
| print                | `emit`          | `emit "hi", power`                       |
| if / else            | `when` / `otherwise` | `when x > 0 { } otherwise { }`      |
| else-if chain        | `otherwise when`| `when a {} otherwise when b {}`          |
| while loop           | `reinforce`     | `reinforce x < 10 { x = x + 1 }`         |
| count loop           | `reinforce N times` | `reinforce 3 times { emit "tick" }`  |
| iterate              | `for each … in` | `for each x in [1,2,3] { emit x }`       |
| function             | `agent`         | `agent greet(name) { report "hi " + name }` |
| anonymous function   | `agent(...) {}` | `map(xs, agent(x){ report x * 2 })`      |
| return               | `report`        | `report total`                           |
| true / false         | `live` / `dead` | `when ready == live { }`                 |
| nothing              | `void`          | `seed best = void`                       |
| logic                | `and or not`    | `and`/`or` return the **value** — `x or 9` works |
| handle failure       | `attempt` / `rescue` | `attempt { risky() } rescue err { }` |
| raise a failure      | `fail`          | `fail "no such pathway"`                 |
| import a strand      | `weave`         | `weave "math.nx"` (or `weave "m.nx" as m`) |
| export a name        | `expose`        | `expose area_circle`                     |
| declare capabilities | `needs`         | `needs lookup, notify, spend(max 5)`     |

**Values:** numbers, strings `"..."`, `live`/`dead`, `void`, lists `[1, 2, 3]`,
and a *mesh* (map) `{ "key": value }`. Index with `[]`; a missing mesh key reads as `void`;
negative list indexes count from the end. Strings interpolate embedded expressions with
`{ }` — `emit "strength of {key} is {m[key]}"` — and `\{` gives a literal brace.

## Pattern matching

`match` runs the first arm whose **shape** fits, binding its names:

```nx
match msg {
  ["move", x, y]     { go(x, y) }
  { "kind": "ping" } { pong() }
  [head, ...rest]    { emit head, rest }
  0                  { idle() }
  _                  { unknown(msg) }
}
```

Patterns: literals (`0`, `"hi"`, `live`/`dead`/`void`), `_` (wildcard), a name (binds the value), `[list]` with an optional `...rest`, and `{ "key": pattern }` (matches a *subset* of a mesh). Patterns nest. Bindings are **linear** (a name binds once per arm) and scoped to the arm. If no arm matches, nothing runs — add `_` for a catch-all.

## Pipelines & destructuring

`x | f` is `f(x)`; `x | f(a)` is `f(x, a)` (the piped value becomes the first argument). Pipes read top-to-bottom and chain:

```nx
seed top = scores | filter(passing) | sort | first
```

Destructure a list or mesh in one `seed` (reuses the pattern shapes; a non-match errors):

```nx
seed [head, ...tail] = xs            # head = xs[0], tail = the remaining list
seed { name, score } = player        # binds the "name" and "score" fields
seed { "id": pid } = record          # explicit key form
```

## Gradual types

Annotations are optional and **off by default** — a normal run stays fully dynamic. Pass `--strict` (and `nx test` runs strict) to enforce them as runtime contracts:

```nx
seed n: number = 5
agent area(w: number, h: number = w): number {
  report w * h
}
```

Types: `number`, `string`, `bool`, `list`, `mesh`, `agent`, `void`, `any`. Under `--strict`, a violation at a **seed**, a **parameter**, a **return**, or a **reassignment** of a typed binding raises a clear error. Honest scope: this is runtime contract-checking at those boundaries — not static inference, and containers aren't element-typed (`list` means "any list"). `:` introduces a type; defaults use `=`.

## Concurrency: dispatch & gather

`dispatch f(x)` builds an **unstarted task**; `gather [...]` runs every task on its **own OS thread, in parallel**, blocks until all finish, and returns the results **in order**:

```nx
agent slow(n) { seed s = 0
  for each i in range(n) { s = s + (i % 7) }
  report s
}

emit gather [dispatch slow(8000000), dispatch slow(8000000), dispatch slow(8000000)]
```

`gather` is just an expression (its value is a list), so it composes: `gather tasks | sum`, `seed [a, b] = gather [...]`.

**Isolation is the safety model.** Each task runs in a *fresh* interpreter — it sees the stdlib, its own arguments, and itself (recursion), and **nothing else**. It can't read or mutate the parent's pathways, so there's no shared state to race on. The trade: values cross **by data** (`number`/`string`/`bool`/`list`/`mesh`/`void`) — handing a task an *agent*, or a non-finite number, is rejected at the boundary rather than silently mangled. A task that fails surfaces as a `gather:` error; a hung worker is reclaimed by a timeout. Zero new dependencies — same worker+`Atomics` bones as the live bridge. Full detail and the measured performance honesty in [`CONCURRENCY.md`](CONCURRENCY.md).

### The Physarum scheduler

Where `gather` runs a fixed list, `schedule(name, workers, items)` runs a **batch through a learning pool**. It's the reinforce/decay law applied to *execution*: a batch is distributed across a pool of interchangeable worker-agents proportional to **conductance**, run in parallel, and each worker's conductance is updated from its measured speed — so fast workers pull more flux on later calls, and a worker that fails decays and its items reroute to the survivors.

```nx
agent worker(chunk) {                       # batch in, batch out: one result per item, in order
  seed out = []
  for each x in chunk { out = out + [x * x] }
  report out
}

emit schedule("squares", [worker, worker], [1, 2, 3, 4, 5, 6, 7, 8])   # -> [1, 4, 9, 16, 25, 36, 49, 64]
emit flows("squares")                                                   # each tube's learned conductance
```

Adaptation is across calls (explore, then exploit); the invariants that never vary are: every item processed exactly once, results in item order, and a clearly-faster worker ends with higher conductance. Same isolation/data-boundary as `gather`. Detail in [`CONCURRENCY.md`](CONCURRENCY.md).

### Cooperative concurrency: fibers & channels

`gather`/`schedule` are *parallelism* (many cores). Fibers are the other half — *concurrency*: many tasks interleaving on **one** thread, talking through **channels**. No shared memory; the value passes hand to hand.

```nx
seed ch = channel()
agent producer(c) { seed i = 0
  reinforce i < 3 { give i to c        # send (parks only if a bounded channel is full)
    i = i + 1 } }
agent consumer(c) { seed k = 0
  reinforce k < 3 { take x from c      # receive (parks until a value arrives)
    emit x
    k = k + 1 } }
spawn producer(ch)                     # start a fiber
spawn consumer(ch)                     # -> 0 1 2
```

`spawn` starts a fiber, `yield` reschedules cooperatively, `await(fiber)` gets its result, `drain()` runs them all. The scheduler is single-threaded and **deterministic**, delivery is exactly-once/FIFO, and a fiber's failure or a deadlock always surfaces — never a silent hang. Detail and the honest limits in [`CONCURRENCY.md`](CONCURRENCY.md).

## Handling failure

A program shouldn't die on one bad index. `attempt` runs a block; if a pathway fails — a
bad index, a type error, an unknown pathway, or an explicit `fail` — the failure is caught
and bound to a name as a mesh carrying `message`, `line`, and `value`:

```nx
agent lookup(m, key) {
  attempt {
    when not has(m, key) { fail "no such pathway: " + key }
    report m[key]
  } rescue err {
    report err["message"]    # a failure becomes a graceful value, no crash
  }
}
```

`fail expr` raises a failure an enclosing `attempt` can rescue. `report` is **not** caught —
it still returns from the agent. And because `and`/`or` return the operand value,
`count[w] or 0` gives `0` when the key is missing. See `examples/resilient.nx`.

When a failure *isn't* rescued, it carries a **stack trace** — the chain of agent calls that
led there, innermost first — not just a line number:

```
Nx error (line 1): division by zero
  in c (called at line 2)
  in b (called at line 3)
  in a (called at line 4)
```

Deep traces are truncated, and runaway recursion fails as a clean `Nx error (… call stack went
too deep …)` instead of a raw crash.

## Modules: weave & expose

A file is a *strand*. It keeps everything private unless it `expose`s it; another strand
pulls those names in with `weave`:

```nx
# geo.nx
agent area_circle(r) { report PI * r * r }
seed TAU = PI * 2
expose area_circle
expose TAU
```

```nx
# main.nx
weave "geo.nx"                  # flat: area_circle and TAU are now in scope
emit area_circle(2)

weave "geo.nx" as geo           # or namespaced into a mesh
emit geo["TAU"]
```

Paths resolve relative to the weaving strand. Modules run **once and are cached**, and
**circular weaves are caught**, not looped. And because weaving reads a file, **it's a
granted capability**: an embedded host that builds an interpreter without a module loader
(`run(src, { moduleLoader: null })`) fences `weave` entirely — a sandboxed agent script
can't reach the filesystem through it. The fence holds. See `examples/use-geo.nx`.

## Capabilities: needs & the audit ledger

Nx is the language you hand an *agent*, so safety is part of the execution model, not a bolt-on.
The interpreter can only compute; every real-world power (a db lookup, a message, a payment,
Python eval, a shell command, a compiled binary) is a **capability** the host grants across the
bridge. Nx is designed as a capability-first embeddable language for agent scripts:

**1. A script declares what it may touch — and how far it may go.** `needs lookup, notify` is a
manifest. Once declared, calling a capability *not* in it is refused — **even if the host granted
it.** And a capability can carry a **value budget**: `spend(max 5, total 15)` caps a single call
(`max`) and the cumulative spend across the whole run (`total`), runtime-enforced. The script is
bounded by *its own word*, not by the host's restraint:

```nx
needs lookup, notify, spend(max 5, total 15)
emit lookup("vallartas")     # ok — declared
emit spend(4)                # ok — within the per-call max and the run budget
emit spend(1000000)          # refused: exceeds the per-call max of 5
emit purge("everything")     # refused: 'purge' is not declared in this script's 'needs'
```

That `spend(max 5, total 15)` is the exact shape of the real Nexus outward gate ($5/tx, $15/day)
— now a single line of the script's own contract instead of bespoke host code. See
`examples/outward-gate.nx`.

**2. Every privileged call is logged.** The runtime keeps an **audit ledger** — name, args, and
outcome of each capability call, *including refusals* — handed back to the host after the run
(even if it failed):

```js
run(agentSrc, {
  natives: { lookup, notify, spend },     // what the host is willing to grant
  onAudit: (ledger) => console.log(ledger),
});
// [ { cap: 'lookup', args: ['vallartas'], ok: true,  result: "..." },
//   { cap: 'spend',  args: ['1000000'],  ok: false, error: 'not declared in needs' } ]
```

Builtins (`len`, `emit`, `map`, …) are **not** capabilities — they're free. Only host-granted
powers are fenced and logged. See `examples/agent.nx` + `examples/host.js` for the whole story:
a fenced agent that overreaches, is stopped, and leaves a complete trail.

Important boundary: the fence governs the call into a capability. It decides whether the script
may call that verb, how many times or how much it may spend, and what gets logged. It does not
sandbox arbitrary code inside a granted runtime. For untrusted or model-written scripts, expose
narrow structured verbs like `score_lead(id)` or `resize_image(input, output)`, not broad verbs
like `pyeval`, `jseval`, `sh`, or raw executable launch.

## The mesh: bridging MCP tools

Capabilities don't have to be hand-written. Hand `run` an **MCP client** and every tool it
exposes becomes a fenced Nx capability automatically — so an Nx script can drive your whole
tool catalog through one law. Whatever language or service is behind a tool (a Python query, a
Rust service, a shell command, a model), from inside the script it's just a verb it was granted:

```nx
needs james_db_query, james_telegram_send

seed lead = james_db_query("SELECT name FROM leads ORDER BY score DESC LIMIT 1")
james_telegram_send({ "text": "new top lead: " + lead })
# james_pm2_action was bridged too, but never declared -> refused before the host is called
```

```js
run(src, {
  mcp: {
    tools: [ { name: 'james_db_query', inputSchema: { properties: { sql: {} }, required: ['sql'] } }, … ],
    call: (name, args) => mcpServer.invoke(name, args),   // your transport; returns the result
  },
  onAudit: (ledger) => console.log(ledger),
});
```

A mesh argument maps to the tool's named arguments; a lone value fills its first required
property (so `query("SELECT …")` works). MCP-style results (`{ content: [...] }`) unwrap to
their text, and an error result becomes a rescuable `fail`. Every call is still bounded by the
script's `needs` manifest and its value budgets, and logged in the audit ledger — the manifest
decides *which* of the bridged tools this script may actually speak. See `examples/nexus-mesh.nx`
+ `examples/mcp-host.js`.

### Running it live (the wire)

Two helpers turn the bridge into a production path an MCP tool can call:

- **`nx-run.js`** — `runScript(script, { client, allow, dir })` → `{ ok, output, audit, error }`.
  Never throws (a tool handler wants a result). Adds a third gate, the **host allowlist** (`allow`
  decides which tools are even *bridged* — absence beats refusal), on top of the script's `needs`
  and its budgets. Production defaults require a `needs` manifest and fence `weave` unless the
  host explicitly grants a module loader.
- **`nx-live.js`** — `runLive(script, { tools, onCall, allow })` → `Promise<{ ok, output, audit }>`.
  Real tools are **async**; Nx is **synchronous**. This bridges them with zero dependencies via
  `worker_threads` + `Atomics`: the script runs in a Worker and each call round-trips to the host's
  async `onCall(name, args)`, the Worker parking until the result is posted back. The transport
  stays abstract, so the same runner wires into any host. `timeoutMs` and `maxSteps` provide wall
  clock and instruction-fuel backstops. See `examples/james-nx-demo.js`.

This is how `james_nx_run` is built in the live Nexus: a curated, safe allowlist of JAMES tools,
an `onCall` over the real handlers, and `runLive` doing gated, audited work a local model's script
cannot exceed unless the host exposes a broader capability. The live JAMES surface deliberately
uses narrow read/request verbs rather than eval, shell, direct messaging, or direct writes.

The JAMES bridge deliberately exposes only narrow hands to Nx. Current capabilities:

- `james_db_query`, `james_read_notes` — read paths.
- `james_approval_request`, `james_approval_list` — human-review queue only; no execution.
- `james_git_push_request`, `james_action_await` — outwardGate one-tap path for `git_push` only. It is not raw `james_action_stage`; the repo/branch still must pass JAMES's git allowlist and Milton must approve before anything pushes.

The unsafe/direct verbs stay absent: no direct memory write, no thought-board post, no Telegram
send, no PM2 control, no secrets, no sandbox exec, no rollback, and no generic outward action
staging. Nx can ask for human review; it cannot quietly perform those side effects through
`james_nx_run`.

## The Law engine

Every named pathway carries a **strength** that starts at 1 and rises each time the pathway
is read — *useful pathways reinforce through use*. Two builtins make the mesh visible and
self-pruning:

- `mesh()` — returns the live pathway graph as a mesh of `name: strength`
- `prune(threshold)` — removes pathways below `threshold`, returns how many fell

Run any script with `--trace` to watch the mesh as a bar chart of strengths after it ends.

## Built-in agents

**Core:** `len` · `type` · `keys` · `values` · `has` · `range` · `push` · `pop` · `shift` ·
`unshift` · `str` · `num` · `mesh` · `prune`
**Strings:** `upper` · `lower` · `trim` · `split` · `join` · `replace` · `repeat` · `chars` ·
`starts` · `ends`
**Sequences (string or list):** `slice` · `find` · `reverse` · `sort` · `entries` · `merge`
**Math:** `abs` · `floor` · `ceil` · `round` · `sqrt` · `pow` · `log` · `sin` · `cos` · `tan` ·
`max` · `min` · `random`

And from `std.nx` (written in Nx itself): `map` · `filter` · `reduce` · `sum` · `biggest` ·
`contains` · `count` · `first` · `last` · `clamp` · `words` · `lines`, plus the constants
`PI` and `E`.

> **Where Nx is headed:** the full design — modules, async agents, the self-optimizing mesh,
> the finished capability fence, and the honest pitch for why Nx becomes the go-to language of
> the agent era — is laid out in [`VISION.md`](VISION.md). *Leave nothing unimagined.*

## Running Nx Independently

Nx is usable without JAMES/Nexus or any foreign runtime:

```
node nx.js examples/fib.nx
node nx.js
node nx.js fmt examples/fib.nx
npm test
```

That standalone surface is part of the contract. Polyglot bridges add reach; they do not make
Nx dependent on the bridged language.

## Editor support (LSP)

`node nx.js lsp` (or `npm run lsp`) starts a stdio JSON-RPC language server: live diagnostics (syntax/parse errors), hover docs on keywords and builtins, completion (keywords + builtins + the top-level names in your file), and format-on-command. Point any LSP client at the `nx lsp` command.

Honest scope (v1): diagnostics are **syntax-only** — a file that parses but is semantically broken (a type error under `--strict`, a wrong arity) shows no squiggle until you run it. Completion is top-level / not scope-aware. No go-to-definition, references, or rename yet. Formatting **preserves comments** (statement-granular).

## Previewing a script's reach: `nx plan`

`node nx.js plan <file>` is the **fence approval surface** — before you (or a gate) run a script, see exactly what host capabilities it *declares* (`needs`) versus what it *reaches for*, with referenced-but-undeclared flagged (the fence would deny) and over-grants called out. Exit `0` clean / `1` not-clean / `2` couldn't analyze, so a gate can branch on it.

```
$ node nx.js plan job.nx
Declared capabilities (needs):
  db_query
Capabilities referenced in code:
  db_query        OK declared
  telegram_send   XX NOT declared (line 4) — the fence would deny it
VERDICT: 1 referenced capability(ies) not declared — this script would be REFUSED at runtime ...
```

Honest scope: it's a **best-effort preview, not a sound gate** — scope-aware over direct call-sites, but it can't statically tell a host capability from a same-named user agent, nor follow a capability passed as a value or via `weave`. It discloses those blind spots on every run and defers to the **runtime fence** as the real boundary. Use it to see intent and catch mistakes; never approve on it alone.

## Embedding Nx in the Nexus

Nx is built to be driven from Node. `require` it and run source in-process, handing your
own native functions across the host bridge:

```js
const { run } = require('./nx');

// Capture output as a string:
const text = run('emit 2 + 3', { capture: true });   // "5\n"

// Expose host capabilities to scripts (the path to james.* / db / telegram):
run('emit lookup("vallartas")', {
  natives: {
    lookup: (args) => queryNexus(args[0]),   // your JS, callable as an agent in Nx
  },
});
```

`run(src, opts)` options: `capture` (return output instead of printing),
`output` (a custom writer), `natives` (host capabilities — `name → fn(args, interp)`),
`mcp` (an MCP client `{ tools, call }` — every tool becomes a fenced capability),
`onAudit` (receive the capability ledger), `dir` (base directory for `weave`),
`moduleLoader` (override, or `null` to fence `weave`), `maxDepth` (recursion cap),
`maxSteps` (instruction-fuel cap), `requireManifest` (refuse capability calls until `needs`
is declared), and `trace` (append the mesh view).

## Evals — the instrument (Phase 1)

Nx's thesis is that a model writes correct, *safe* agent-code more reliably in Nx than in
Python-in-a-sandbox. The only honest way to know is to measure it, so `nx-evals/` is the
instrument: **30 golden tasks** across six buckets (data · control · agents · fence ·
concurrency · adversarial), each with a reference solution and discriminating checks.

```
node nx-evals/run-evals.js                 # --ref: run every task's reference solution (validates the set)
node nx-evals/run-evals.js --model ollama  # local free baseline (Ollama on :11434)
node nx-evals/run-evals.js --model claude  # frontier tier (ANTHROPIC_API_KEY; costs)
node nx-evals/run-control.js [--model ...] # the Python control group — the Nx-vs-Python delta
```

The harness is adversarially hardened (two independent review passes): execution is
fuel-bounded so one runaway solution can't hang the run; **fence tasks are scored on the
capability audit ledger**, not just stdout, so a hardcoded-emit cheat fails; a required
construct (`match`, `dispatch`/`gather`, …) is gated against dead-branch and comment/string
bypasses; and a model's own test blocks are stripped before scoring. First baseline numbers
and the honest scope live in [`nx-evals/BASELINE.md`](nx-evals/BASELINE.md).

## How it works

A classic tree-walking interpreter in four stages, one file each:

```
.nx source → lexer.js → parser.js → interpreter.js ⇄ builtins.js → output
              tokens      AST          walk + eval     host bridge
```

- **`lexer.js`** — text → tokens, tracking line/col for errors
- **`parser.js`** — recursive descent + precedence climbing → AST
- **`interpreter.js`** — the `Environment` (pathways + strength + closures) and evaluator
- **`builtins.js`** — native functions and `registerNative` (the host bridge)
- **`mcp-bridge.js`** — turns a catalog of MCP tools into fenced Nx capabilities
- **`std.nx`** — the standard library, bootstrapped in Nx
- **`nx.js`** — CLI, REPL, and the `run()` embed API

Errors are a single `NxError` type carrying a line number, so the lexer, parser, and
interpreter all point at exactly where a program went wrong.

## License

MIT.
