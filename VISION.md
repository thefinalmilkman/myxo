# Nx — The Vision: leave nothing unimagined

> Nx is Milton's language. Its keywords *are* the Nexus law — `seed`, `reinforce`,
> `decay`, `agent` — and its only bridge to the world is a **capability fence**: an Nx
> script can touch nothing the host did not explicitly hand it. This document imagines
> Nx **whole** — everything it becomes when perfected — and lays the honest road from
> here to there. Dream first; the roadmap at the end is real.

---

## 0. The thesis — why Nx deserves to exist
Nx must be independent: a language you can install, run, learn, test, package, and ship,
not a thin prompt wrapper around Python, C++, Node, JAMES, or any one host. It should become
a peer in the toolchain the way Python and C++ are peers: its own source files, runtime,
standard library, errors, modules, docs, release path, and community surface.

That does **not** mean Nx should imitate Python's data ecosystem or C++'s systems niche.
Most languages are general; Nx wins by owning a domain that is exploding and has no good
language yet: **the script you hand an autonomous agent.**

In the agent era, code is increasingly *written by* and *executed by* AI. That code needs
two things almost no existing language gives it natively:
1. **Capability by construction** — the agent can only do what it was granted. Not a
   sandbox bolted on, not a permission list checked at runtime — *absence*. "`spend()`
   isn't blocked; it doesn't exist in this agent's universe. There's nothing to bypass."
2. **Code that reads like intent** — `seed`, `reinforce`, `decay`, `agent`, `attempt`,
   `rescue` — a vocabulary a human can audit at a glance and a model can emit cleanly.

Plus one idea no other language has: **the program gardens itself.** Useful pathways
reinforce, useless ones decay and get pruned — at runtime, in the language's own bones.

That is the go-to claim, honestly stated: **Nx becomes "the next go-to for coding" the way
SQL is the go-to for queries** — independent like Python/C++, but winning by *owning the
agent-action domain* so completely that reaching for anything else feels wrong.

---

## ✅ v0.6 — THE LIVING MESH IS REAL (shipped 2026-06-26, two-agent gated)
The "gardens itself" idea above is no longer aspiration — the runtime now ACTS on pathway strength:

- **Hot-promote (automatic):** a *hot* + *provably-pure* agent memoizes itself. No keyword, no cache call — the runtime watches the pathway and promotes it. `fib(30)` is instant despite ~2.7M naive calls. ("Useful pathways reinforce", executing.)
- **`strength(name)`:** read any pathway's heat in-language.
- **`metabolize(threshold)`:** the decay half, as an explicit VERB you call — sweeps cold pathways, reports `{reaped, count, promoted}`. (`prune` is its terse twin.)

**Honest scope (the gate insisted, and it was right):**
- "Self-optimizing" = automatic *memoization of pure agents* — a real, measurable optimization, not magic.
- Cold-decay is **NOT** a background garbage collector. `metabolize`/`prune` are verbs the program/host invokes; there is no autonomous time-based sweep (yet).
- Memoization is **sound, not invisible**: a value is served only from a call the runtime proved pure — plain params only; never tainted by a capability / `random` / `emit` / `weave` / a state-reading builtin (`mesh`/`strength`) / an outer write / a free DATA read (reading a free *agent* is allowed, for recursion); primitive args + result; and a global **epoch** invalidates every cache on any global write. A two-agent review found 4 real staleness bugs + a dead off-switch in the first cut — all fixed and pinned by `soundness:` tests (memo-ON must equal memo-OFF). It does NOT claim to leave mesh *strengths* identical — collapsing repeated work also collapses repeated reinforcement, by design.
- **89 tests green.** Demo: `examples/living-mesh.nx`.

---

## ✅ POLYGLOT BRIDGE — Nx connects other languages (shipped 2026-06-26, two-agent gated)
A capability is just `name → fn`, so each language is a fenced RUNNER (`polyglot.js`). **Two tiers — honest, NOT one contract:**
- **RICH** — `defineLang()` → value-mapped `Xcall(file,func,...args)` + `Xeval(expr)` (mesh/list/number/bool round-trip; structured returns). Built + tested here: **Python** (`pycall`/`pyeval`) and **Node** (`jscall`/`jseval`). **Perl** (`plcall`/`pleval`) is implemented and tested when `perl` is on PATH; on this machine those tests currently skip. Needs a runtime with an eval flag; Ruby (`-e`) fits the same future shape. Each harness is small but **not trivial** — it carries that language's module-load / hard-exit / JSON / eval quirks.
- **WEAK** — `bridgeExec(cmd)` → raw stdout string in/out, *no value mapping*; the only path for compiled langs (Go/Rust/C++ binaries) + CLIs. Plus `sh`.

Every cross-language call passes the outer Nx law at the boundary: declared in `needs`, bounded by budgets (numeric first-arg = spend; otherwise = **call count**), logged in the audit ledger. Non-finite numbers are an explicit error on every rich path (never a silent null). Compiled languages currently plug in through `bridgeExec`/CLI stdout unless the host wraps them as narrower structured capabilities. Demo `examples/polyglot.nx`; 19 passing polyglot tests plus 5 Perl skips when `perl` is absent.

**Honest boundary (the gate insisted, and it was right):** `pyeval`/`pycall`/`sh` are **ARBITRARY-CODE** capabilities — granting one grants the FULL power of that runtime. The fence bounds WHICH verb a script may reach and HOW MANY times, **NOT** what the code inside that verb does (the ledger logs `pyeval`, not the subprocess it spawned). For untrusted / model-generated callers, expose only **STRUCTURED** capabilities (one specific tool/function), where the fence is meaningful end to end. "Slime mold" = the governance + living-mesh strength bookkeeping; there is **no automatic language-routing yet** (a future plank). The gate caught + fixed: non-finite returns crashing raw, an `atexit` result-spoof, inert budgets on string-arg verbs, and structured-arg flattening.

---

## Independence contract — Nx is not just glue
Polyglot bridging is core, but the bridge must not become the identity. Nx remains its own
language with its own execution model. Foreign runtimes are FFI surfaces: Python for Python
work, C++/Rust/Go binaries for compiled work, Node for JS work, MCP for tool catalogs. Nx is
the independent boundary layer that decides what can be called, how often, with what budget,
and what gets logged. It does not sandbox arbitrary code after a host grants a broad runtime
verb.

The standalone contract is tracked in [`INDEPENDENCE.md`](INDEPENDENCE.md):
- A `.nx` program must run from the Nx CLI without JAMES/Nexus.
- Nx semantics live in Nx: `agent`, `needs`, budgets, audit ledger, pathway strength, routing.
- Tooling grows around Nx itself: formatter, tests, docs, module rules, LSP/debugger, release path.
- Other languages extend Nx through explicit capabilities; they do not define Nx.

---

## ✅ AUTOMATIC FLOW-ROUTING — the slime mold re-routes itself (shipped 2026-06-26, two-agent gated)
`route(name, [providers])` makes interchangeable providers (agents / tools / languages) one logical capability and the runtime LEARNS which to use. **Conductance = each tube's recent QUALITY** (an EWMA of success + speed); traffic flows **proportional to conductance** (deterministic weighted round-robin) with a minimum exploratory flux per tube. `flows(name)` shows the live conductances. Verified behaviors:
- **Converges + dominates** — a clear winner gets the lion's share (broken-vs-good → good ~100%).
- **Instant failover** — a working provider that starts failing is dropped within ~1 call; traffic shifts to the alternative.
- **Genuine re-balance** — because conductance tracks recent quality (not cumulative volume), a FASTER recovered provider OVERTAKES a slower incumbent — the exact thing winner-take-all could not do.
- **Fairness** — two equally-good providers share traffic (no list-order lock-in).
- **Does NOT route around the law** — a fence/policy denial propagates; it is never masked as a transient outage.
- **Composes with the living mesh** — a PURE slow provider gets memoized (becomes fast), so speed-routing matters exactly where latency is real: impure I/O.

**Honest scope (the gate insisted, twice):** it is **exploit-leaning** (concentrates on the best tube + a small constant exploratory flux); the dynamics are governed by **hand-tuned constants** (EWMA α, explore floor); "shortest path wins" resolves only for latency gaps the clock can measure. The first cut (winner-take-all + rare re-probe) was proven to NOT re-balance and to lock in by list order — redesigned to EWMA proportional flux, which does. Demo `examples/flow-routing.nx`; 111 tests.

---

## 1. Shipped today (v0.5-core, 2026-06-14)
- Tree-walking interpreter, **zero dependencies**, CLI + REPL + embed API.
- Values: number, string, bool (`live`/`dead`), `void`, list, mesh, agent.
- First-class agents, closures, recursion; `seed`/`=`/`decay`.
- Control: `when`/`otherwise`, `reinforce` (while), `reinforce N times`, `for each`.
- **Error handling: `attempt { } rescue err { }` + `fail expr`**.
- **Value-returning `and`/`or`** — `x or default`.
- **A real stdlib**: strings (split/join/trim/replace/slice/find/reverse/…),
  math (pow/log/sin/cos/round/random/PI/E), collections (sort/merge/entries/clamp/…).
- The Law engine: strength-per-read, `prune()`, `mesh()`, `--trace`.
- The **capability fence**: `run(src, { natives })` is the only grant surface.
- **Modules** *(v0.3)*: `weave "strand.nx"` (flat or `as`-namespaced) + `expose name` —
  private-by-default, run-once-cached, cycle-safe, and **fenced** (file access is granted).
- **String interpolation** *(v0.3)*: `"strength is {m[key]}"` — nested strings + escaped braces handled.
- **Multi-line REPL** *(v0.3)*: type an `agent` definition across lines (`..>` continuation).
- **Variadic + default params** *(v0.3 ✅)*: `agent log(msg, level = "info", ...rest) { }`, arity-checked.
- **Capability manifests + value budgets** *(v0.5 ✅)*: `needs lookup, notify, spend(max 5, total 15)`.
  Undeclared capabilities are refused *even if the host granted them*; `max` caps a single call,
  `total` caps the cumulative spend across the run — the script is bounded by **its own word**.
- **Audit ledger** *(v0.5 ✅)*: every privileged call and refusal (name, args, outcome) handed
  to the host via `onAudit`, even when the run fails.
- **Stack traces + a recursion guard** *(v0.5 ✅)*: `NxError` carries the agent call chain
  (innermost first, truncated when deep); runaway recursion fails as a clean Nx error, never a raw crash.
- **The MCP bridge** *(v0.5 ✅)*: hand `run` an MCP client and **every tool becomes a fenced
  capability** — one Nx script drives the whole tool catalog, each call bounded by the manifest
  and budgets and logged in the ledger. This is the mesh: many languages/services, one law.
  Transport-agnostic (`client.call` is synchronous; a live async server gets a sync shim).
  See `examples/nexus-mesh.nx` + `examples/mcp-host.js`.
- **60 passing tests.**

---

## 2. The full imagined Nx (leave nothing unimagined)
*Everything below is design, not yet built. Keywords stay in the Nexus tongue.*

### 2a. Language
- **Modules — SHIPPED in v0.3 ✅** (`weave`/`expose`, fenced, cached, cycle-safe). The next
  composability layers ride on it: string interpolation, variadic/default params, a multi-line REPL.
- **String interpolation — SHIPPED v0.3 ✅** — `"strength of {key} is {m[key]}"` (nested strings + `\{` escapes).
- **Pattern matching — SHIPPED ✅** — `match SUBJECT { ["move", x, y] { } { "kind": k } { } 0 { } _ { } }`: literals / `_` / name-binds / `[list ...rest]` / `{ "key": pat }` (mesh subset), nested; first arm wins; bindings are linear (a repeated name is rejected) and arm-scoped; no match = no-op. A new `match` keyword, not `when` (`when x { foo { } }` would be ambiguous). Gate-hardened; `examples/match.nx`, `test/match.test.js`.
- **Gradual types — SHIPPED ✅** — optional annotations `seed n: number = 5`, `agent f(x: number = 1, ...rest): list`. Enforced as **runtime contracts** (not static inference) at three boundaries — seed-init, parameter, return — AND on reassignment of a typed binding. **Opt-in via `--strict`** (and `nx test`); a normal run stays fully dynamic and ignores them. Types: number/string/bool/list/mesh/agent/void/any (`any` opts back out). Honest scope: containers aren't element-typed (`list` = any list), no unions/generics/inference. Grammar note: param defaults now use `=` (`name: Type = default`); `:` introduces a type.
- **Variadic + default params — SHIPPED v0.3 ✅** — `agent log(msg, level = "info", ...rest) { }`, arity-checked.
- **Pipelines — SHIPPED ✅** — `text | lower | words | sort` reads top-to-bottom; `x | f` is `f(x)`, `x | f(a)` is `f(x, a)` (piped value = first arg). Lowest precedence, left-assoc; a `Pipe` node, fully fenced/memoized like any call.
- **Destructuring — SHIPPED ✅** — `seed [head, ...tail] = xs`, `seed { a, b } = m` (mesh shorthand) / `seed { "k": v } = m`. Reuses the pattern engine; a non-match errors (no half-binding), bindings are linear.

### 2b. The self-optimizing mesh (Nx's signature, unique to it)
The law is currently a *metaphor with a +1-per-read counter*. Imagine it **load-bearing**:
- **Pathway strength is introspectable in-language** (`strength(name)`), not just globals.
- **Hot agents auto-promote**: a frequently-called agent gets memoized / its closure cached;
  the runtime literally makes the used paths faster.
- **Cold code auto-prunes**: pathways below a decay threshold are swept between phases — a
  program that *sheds the branches it stopped using*. A garbage collector that is the
  Nexus law, not a bolt-on.
- **`physarum.nx` becomes the scheduler**: the same Tero flow²/√flow dial that routes the
  Physarum Mesh routes *which agents run* under load. The language and the architecture
  become the same law (this is the [[nexus-coherence]] dream made literal).

### 2c. Concurrency, the Nexus way
- **`dispatch f(x)`** starts an agent running in parallel, returns a handle.
- **`gather [h1, h2]`** awaits them; results flow back as a list.
- **`channel`** — a mesh-backed signal agents push/pull on (reinforced channels survive,
  idle ones decay). Concurrency that obeys the law instead of fighting it.
- Async natives (the host grants an async capability; Nx `attempt`s it, `rescue`s timeouts).

### 2d. The capability ecosystem (the killer feature)
- **Capability manifests — SHIPPED v0.5 ✅**: a script *declares* what it may touch
  (`needs lookup, notify`); calling anything undeclared is refused **even if the host granted
  it** — the agent can't exceed its own stated reach.
- **Value budgets — SHIPPED v0.5 ✅**: `needs spend(max 5, total 15)` — `max` caps a single
  call, `total` caps the cumulative spend across the run, runtime-enforced and logged. This is
  the exact shape of the real outward gate ($5/tx, $15/day), now a *language* construct, not
  bespoke host code. See `examples/outward-gate.nx`.
- **Audit ledger — SHIPPED v0.5 ✅**: every privileged call and refusal (name, args, outcome)
  is handed back to the host after the run, even on failure. The who/what/when is in the
  runtime, not the app. See `examples/host.js`.
- **Still to wire (the live grants)**: the *shaped* natives themselves — `james.db` read-only
  lookup, `telegram.send`, the outward gate's one-tap Telegram approval. The fence, the
  manifest, the budgets, and the ledger are done; what remains is binding them to the real
  Nexus tools instead of the mock natives in `examples/host.js` / `fenced-agent.js`.
- **Gated/staged actions** *(design)*: dangerous calls return a *pending* a human approves —
  the approval round-trip layered on top of the budgets already enforced.
- This is the thing that makes Nx *the* language to hand a local model: it physically cannot
  exceed its grant, and every outward action is logged and capped by construction.

### 2e. Tooling (developer experience)
- **Multi-line REPL — SHIPPED v0.3 ✅** (block-aware; `..>` continuation). *(Was single-line.)*
- **`nx fmt` — SHIPPED ✅** — an AST-based formatter (one true style); refuses invalid code.
- **`nx test` — SHIPPED ✅** — `test "name" { expect X is Y / is not / to fail / to fail with "…" }`, written in Nx; `node nx.js test <file|dir>` reports ok/FAIL and exits non-zero (incl. "no tests ran"). Nx tests ITSELF in Nx (`tests/lang.test.nx`); the runner's own correctness is pinned in `test/nxtest.test.js`. Two-agent gated — the gate killed every false-green (a `report`, a wrong-error `to fail`, an empty/zero-assert test, or an uncalled-function truthy can no longer pass green).
- **LSP — SHIPPED (v1) ✅** — a stdio JSON-RPC language server (`nx-lsp.js`, `nx lsp`): live **diagnostics** (syntax/parse), **hover** (keyword + builtin docs), **completion** (keywords + builtins + top-level file names), and **formatting** (refuses commented files rather than stripping). Honest scope: syntax-only diagnostics (no semantic/type squiggles), top-level-only/scope-unaware completion, no go-to-definition/references/rename yet; pure analysis core unit-tested + a real stdio wire round-trip. Future: semantic diagnostics, go-to-pathway, inline strength heat-map.
- **Debugger** — step, breakpoints, and a live **mesh-trace** (watch pathways reinforce/decay
  as you step). No other debugger can show you a program *gardening itself*.
- **Stack traces — SHIPPED v0.5 ✅** — `NxError` carries the agent call chain (innermost first,
  truncated when deep), plus a recursion-depth guard that turns a runaway into a clean error.

### 2f. Performance & interop
- **Bytecode VM** — compile the AST to a small instruction set; keep the tree-walker as the
  reference. Enough for loop-heavy agent scripts (today: pure tree-walk).
- **Independent runtime path** — keep the Node tree-walker as the reference implementation, then
  define a portable wire/spec and eventual bytecode/native runtime so Nx is not permanently tied
  to Node as its only engine.
- **MCP bridge — SHIPPED v0.5 ✅** — any MCP tool auto-becomes a fenced Nx capability
  (`mcp-bridge.js`). Nx is now the single fenced surface a whole tool catalog is spoken through:
  the lookup may be Python, the send JS, the action a shell — the script only knows the verb it
  was granted. *This is the mesh that connects all languages, by orchestration not translation.*
- **Polyglot embedding** *(next)* — a tiny wire protocol so Python/Go/Rust *hosts* can run Nx and
  grant natives, not just Node. The MCP bridge connects tools; this connects hosts.
- **Nx ↔ JSON — SHIPPED v0.5 ✅** (in the bridge): mesh ⇄ object / list ⇄ array, so agent I/O is frictionless.

---

## 3. The honest roadmap
| Version | Theme | Contents |
|---|---|---|
| **v0.2** ✅ | *Robust enough to write real programs* | error handling, value-`or`, full stdlib |
| **v0.3** ✅ | *Composable* | modules, string interpolation, multi-line REPL, **variadic/default params** |
| **v0.5** 🟢 | *The fence + the mesh, for real* | **manifests ✅, value budgets ✅, audit ledger ✅, stack traces ✅, MCP bridge ✅, the wire ✅** (`nx-run` host-allowlist + `nx-live` sync-over-async worker bridge + `james_nx_run` added to JAMES `mcp-server.js`) — remaining: reload the live MCP server to expose it, then `nx fmt` |
| **v1.0** ✅ | *A language you'd ship* | **SHIPPED** — independence · `nx fmt` · `nx test` · pattern matching · pipelines · destructuring · gradual types (`--strict`) · spec (`SPEC.md`) · LSP v1 · stable CLI · docs site (`docs/`). **v1.0 COMPLETE — 232 tests + 11 self-host, every plank two-agent-gated.** |
| **v1.1** ✅ | *The endgame begun — real concurrency* | **SHIPPED** — `dispatch`/`gather`: genuine multi-core parallelism on the `nx-live` worker+Atomics bones (zero new deps). Isolation-as-safety (a fresh interpreter per task — no shared state to race), by-value data boundary, blocking Atomics barrier, honest timeout backstop. **252 tests + 11 self-host, two-agent-gated (the gate caught a silent-NaN coercion + a crash-path hang; both fixed).** See `CONCURRENCY.md`. |
| **v1.2** ✅ | *The signature, shipped — the Physarum scheduler* | **SHIPPED** — `schedule(name, workers, items)`: the reinforce/decay law applied to **execution**. A batch is distributed across a learning pool of worker-agents ∝ conductance, run in parallel (on `gather`'s bones), conductance updated from measured speed (fast workers pull more flux; failed ones decay and their items reroute to survivors). The mesh routes work across agents under load — the language *is* the architecture. **268 tests + 11 self-host, two-agent-gated (both gates converged on a small-batch starvation gap — fixed by persisting the pool's credit).** See `CONCURRENCY.md`. |
| **v1.3** ✅ | *Cooperative concurrency — fibers + channels* | **SHIPPED** — `spawn` fibers + channels (`give … to` / `take … from`), `yield`, `await`, `drain`: the *concurrency* half (interleaving on one thread, communicating hand-to-hand through channels) to complement the parallelism of `gather`/`schedule`. Deterministic scheduler, exactly-once FIFO delivery, deadlock detection, no silent hang. **308 tests + 11 self-host, two-agent-gated TWICE (the re-gate of the fix pass caught a silent dropped-error I'd introduced — fixed).** See `CONCURRENCY.md`. |
| **v1.4** ✅ | *The fence approval surface — `nx plan`* | **SHIPPED** — `nx plan <file>`: a static capability preview (declared `needs` vs referenced capabilities; over-grants; exit 0/1/2 for a gate). Grinding the load-bearing stat for the quest — vet a script's reach before running it. **329 tests + 11 self-host, two-agent-gated + re-gated (gates found FIVE real false-cleans incl. decoy-agent + declaration-order masking — fixed via a scope-aware two-mode analyzer; the irreducible static limit is now honestly DISCLOSED, with the runtime fence as the actual boundary).** Honest: best-effort lint, not a sound gate. |
| **v1.5** ✅ | *Toward 100% — comment-preserving `nx fmt`* | **SHIPPED** — the formatter now PRESERVES comments (collected from the real lexer, re-attached by line) instead of dropping/refusing them. Removed the most-cited wart. **334 tests + 11 self-host, two-agent-gated (gates found a CRITICAL: an interpolation-blind scanner FABRICATED comments from string content — fixed at the root by capturing comments in the real tokenizer; plus block-tail/placement fixes via parser end-lines).** Honest: statement-granular (a one-line-block / multiline / inline-agent trailing comment may shift to its own line; never dropped or fabricated). |
| **v2.0** | *Deepening the signature* | channel `select`/timeouts/closeable channels, suspension across called-agent boundaries, a thread-reuse **worker pool**, multi-tier failover, the self-optimizing mesh (hot-promote/cold-prune at runtime), bytecode VM, portable runtime path |
| **North star** | *The independent safe action-language of the agent era* | polyglot embedding, the Physarum scheduler, an ecosystem of fenced capability modules |

**Honest caveat (full Max doesn't lie):** "the next go-to for coding" in the *general* sense
is a decade-and-an-ecosystem and most languages never make it. But "the go-to for *the agent
action layer*" is a real, winnable, expanding niche — and Nx already has the two hardest
pieces (the fence + the law) that no incumbent has. That is the door we walk through.

---

## 4. Where we actually are
Vision is cheap without a foundation, so none of this is a promise — it shipped. v0.2 made Nx
robust (catches its own failures, real stdlib). v0.3 made it composable (modules, interpolation,
multi-line REPL, variadic/default params). And v0.5 built **the thing that makes Nx worth
choosing over Lua, a JS sandbox, or RestrictedPython** for agent scripting:

- a script declares its capabilities (`needs …`) and can't exceed them even if the host is generous;
- those capabilities carry **value budgets** (`spend(max 5, total 15)`) the runtime enforces —
  the exact policy the real outward gate runs in JS, now a single line of the script's own contract;
- every privileged call and refusal lands in an **audit ledger** handed to the host;
- failures come with a **stack trace** and runaway recursion fails clean;
- and the **MCP bridge** turns a whole tool catalog into fenced capabilities — one Nx script
  drives every tool in the Nexus through one law, whatever language each tool is written in.

**60 tests green.** That's the honest claim made real, and bigger than "a safe sandbox": for
*the script you hand an autonomous agent*, Nx is best-in-class, AND it is the **single fenced
surface the whole tool mesh is spoken through** — safety, budgets, the audit trail, and the
cross-language bridge are all language features, not things you bolt on. What's left for v0.5 to
close is wiring a *live* MCP server (the async shim) so a local model's Nx scripts do gated,
audited, real work across the Nexus.

*Companions: `README.md` (how to use what's built), `examples/host.js` + `examples/agent.nx`
(the fence + ledger live), `examples/outward-gate.nx` (the real spend policy as a manifest),
`examples/mcp-host.js` + `examples/nexus-mesh.nx` (the MCP bridge — many tools, one law).
Nx lives at `C:\Users\Milton\nx-lang\`.*
