# Nx — Road to 1.0

> **Mission lock:** Nx is the safe substrate for AI-generated code — the language a model writes when you can't afford to trust the model. **Not** a Python replacement.

Status when this landed: **v1.5.0**, 335 node tests + 11 self-host green, spec at `SPEC.md`.

---

## Arc's sharpening notes (2026-07-01)

**Verdict: green light.** This is the most disciplined plan written about Nx and it is mission-true. Four sharpenings folded into how we execute — the plan text below is preserved verbatim as the source of record.

1. **The two-agent adversarial gate is a STANDING requirement through Phases 2–4, not just "tests."** It has been Nx's actual quality engine on every stone (it caught the memoization staleness, the value-budget-zero bypass, the warden metering flaw, the `nx plan` false-cleans — all while green tests passed). Fuzzing (Phase 4) catches crashes; it does **not** catch subtle soundness/semantic bugs. Every language/fence change in Phases 2–3 ships only after cold-reviewer + adversary.
2. **Never let a paid model gate the instrument.** Phase 1's frontier tier uses the **Claude API key we already have** (`ANTHROPIC_API_KEY`); the mid/small tier uses **local Ollama** (qwen2.5-coder / phi) — near-zero cost, fully repeatable. The eval harness must never be blocked on a bill.
3. **The Week-3 baseline IS the first thesis verdict — read it then, not only at Phase 5.** If a frontier model already writes fenced Python-in-a-sandbox as reliably as Nx at baseline, that's a yellow flag *before* sinking Phases 2–6. Treat the baseline delta as a leading indicator.
4. **Phase 2's breaking-change window closes at Phase 7.** Almost no Nx exists in the wild yet (examples + 2 dogfood apps), so spending breaks now is nearly free. Once Nexus dogfoods 3 live policies (Week 8), every break costs migration. Land all Phase-2 breaks before Phase-7 policies are written.

Phase 1 scaffold lives in `nx-evals/` (built 2026-07-01; harness runs, seed golden tasks validated — expand to the full 30).

---

## 0. DEFINITION OF DONE

Languages are never finished; products are. "100%" means all of the following are true, checkable, and checked:

1. **Spec locked at 2.0** — every breaking change spent, spec frozen, versioned, and small enough to live in a system prompt (≤ ~6K tokens).
2. **Eval-proven** — a frontier model with only the spec in context passes ≥ 90% of the golden set; a mid-tier local model (7–14B) passes ≥ 60%. Numbers tracked per release, no regressions shipped.
3. **Crash-free guarantee** — no input source text can crash the host process. Fuzzed to exhaustion; every failure is a clean NxError.
4. **Fence complete** — per-module manifests, polyglot ungrantable-by-default, plan/fence parity documented, threat model written.
5. **Nexus runs on it** — at least three real Nexus policies/routines in production Nx for 30 days without a language-caused incident.
6. **Distributed** — installable in one command, repo public, docs complete, the spec-as-prompt file downloadable as a product artifact.
7. **Maintenance mode defined** — a written policy for what gets fixed (bugs, security) and what gets refused (features), so 1.0 stays 1.0.

Everything below exists to make those seven lines true.

---

## PHASE 1 — THE EVAL HARNESS (build this before touching the language)
**~2–3 weekends. Nothing else starts until this runs.**

The harness is the instrument; without it every later decision is vibes.

**Deliverables:**
- `nx-evals/` repo directory: `tasks/` (one folder per task: `prompt.md`, `checks.nx` or expected-output file), `run-evals.js` (harness), `results/` (JSONL per run: model, task, pass/fail, error class, tokens).
- **30 golden tasks** across 6 buckets, 5 each:
  1. Data shaping (parse/filter/transform lists & meshes)
  2. Control flow (match, loops, attempt/rescue)
  3. Agents & closures (recursion, defaults, rest params, pipelines)
  4. Fence usage (needs manifests, budgets, correct denial handling)
  5. Concurrency (dispatch/gather, fibers/channels)
  6. Adversarial (tasks that tempt the footguns: newline gluing, mesh key coercion, identity equality)
- Harness runs: model + spec-in-context → generated Nx → executed against checks via `run()` with `maxSteps` fuel → pass/fail + captured error.
- Baseline run against 3 models (one frontier via OpenRouter, one mid, one local 7B) and — this is the control group — the same 30 tasks in Python. The Python delta IS the product metric.

**Acceptance:** one command produces a scoreboard; results are git-committed; the first baseline numbers exist, however ugly.

**Why first:** every phase below claims to improve AI-writability. This is the only thing that can prove it.

> ### ✅ PHASE 1 COMPLETE (2026-07-02)
> - **30 golden tasks** (6 buckets × 5), reference set green (`--ref` = 30/30), each two-agent-gated.
> - **`run-evals.js`** hardened by cold-reviewer + adversary: audit-ledger scoring for fence tasks (a hardcoded-emit cheat fails), fuel-bounded execution (no infinite-loop hang), construct gate (dead-branch/comment/string-proof), self-test stripping, parse-first error classification, append-with-provenance results. Pinned by `test/evals.test.js` (18 regressions); full suite **371 node + 11 self-host green**.
> - **Generators:** `ollama.js` (free), `claude.js` (frontier, wired via the claude-api skill).
> - **Python control group** (`run-control.js` + 20 `control/` triples) for the Nx-vs-Python delta; fence/concurrency correctly excluded (no fair plain-Python control — that's the moat).
> - **First baselines** in [`nx-evals/BASELINE.md`](../nx-evals/BASELINE.md). Headline: `qwen2.5-coder:7b` scores **0/30 on Nx** (writes C-style syntax) while writing Python fine — a leading indicator that the mid-tier needs Phase 5's prompt-optimized `NX_PROMPT`. Frontier tier is **blocked on Anthropic API credits** (wired + proven-reachable, key balance empty).

---

## PHASE 2 — SPEND THE BREAKING CHANGES (language hardening)
**~3–4 weekends. The last time the language is allowed to change shape.**

Fix everything that the adversarial bucket and first baseline expose, plus the known footguns. Candidates, decided BY EVAL DATA, not taste:

- **Newline gluing** (`x` ⏎ `-3` → `x - 3`): adopt a restriction rule — a line starting with `(`, `[`, or unary `-` does not continue the previous statement unless the previous line is syntactically incomplete. Measure re-run of adversarial bucket before/after.
- **Mesh literal keys:** require quoted strings or `[expr]` computed-key syntax; make bare `{ a: 1 }` mean the literal key `"a"` (the JS convention every model already knows). The current pathway-value-as-key behavior is a model trap precisely because it defies the corpus prior.
- **Numeric key round-trip:** document loudly or fix; pick one, spec it.
- **Equality:** keep identity semantics but add a `same(a, b)` deep-equality builtin so models stop reaching for `==` on lists (they will — the corpus taught them Python).
- Anything else the adversarial evals surface with ≥ 2 model failures.

**Rule for this phase:** every change ships with (a) spec diff, (b) eval re-run showing improvement or neutrality, (c) migration note. Anything that grows the spec meaningfully must buy its tokens with eval points.

**Acceptance:** adversarial bucket pass rate ≥ 80% frontier; spec still ≤ 6K tokens; CHANGELOG documents every break.

---

## PHASE 3 — FENCE COMPLETION (the moat, finished)
**~2–3 weekends. This is the product's reason to exist; it gets full rigor.**

- **Per-module manifests:** a weaved strand's `needs` no longer merges program-wide. A strand gets only what it declares AND the weaving script re-grants: `weave "x.nx" granting lookup, notify`. Undeclared+ungranted = denied at the strand's call sites. This closes the widening hole in §6/§7 of the spec.
- **Polyglot lockdown:** `pyeval/jscall/sh/...` become `unsafe`-classed natives — hosts must pass `allowUnsafe: true` AND the script must declare them AND `nx plan` flags them in red. Default embed cannot grant them. Document plainly: an unsafe grant nullifies the fence.
- **Budget completeness:** add call-rate budgets (`needs notify(per_run 10)`) alongside value budgets; audit ledger gains a monotonic sequence number and wall-clock timestamps (forensics-grade).
- **Threat model document** (`SECURITY.md`): what the fence guarantees, what it explicitly does not (inside-a-native behavior, side channels, plan unsoundness), the injection scenario walked end-to-end (untrusted text → model → Nx → fence catches the exfil attempt). This document is also marketing — it's the honest artifact competitors won't write.
- **Fence test suite:** 40+ tests, every denial path, every budget edge (negative, NaN, boundary), manifest/grant matrix, module re-grant matrix.

**Acceptance:** fence tests green; a written attack scenario per fence feature with its test; `SECURITY.md` reviewed against Vol 1 §14 trifecta (private data / untrusted input / exfil channel — show which leg the fence breaks).

---

## PHASE 4 — RUNTIME ROBUSTNESS (crash-free, bounded, measured)
**~2–3 weekends.**

- **Fuzzing:** grammar-aware fuzzer (generate from the AST shapes) + mutation fuzzer over the corpus of all eval tasks and tests. Target: 1M+ inputs, zero host crashes, zero hangs (fuel + timeout enforced everywhere, including inside `gather` workers and fibers). Every crash found becomes a regression test.
- **Resource guarantees, spec'd:** maxDepth, maxSteps, gather timeout, fiber step budget, and (new) a memory ceiling per run — documented numbers, tested at the boundary.
- **Performance baseline:** a small benchmark suite (parse speed, interp ops/sec, gather scaling across cores, memoization hit behavior). Not to win benchmarks — to detect regressions and to state honest numbers in docs. Tree-walker speed is fine for the niche; say so plainly rather than promising otherwise.
- **Determinism audit:** enumerate every source of nondeterminism (random, timing in route/schedule, gather ordering guarantees) in one doc section. AI-generated code gets retried and diffed; knowing exactly what's deterministic is a feature.

**Acceptance:** fuzz campaign report committed; zero known crash inputs; benchmark suite runs in CI (plain git hook is fine); determinism section merged into spec.

---

## PHASE 5 — AI ERGONOMICS (tune the language like a model)
**~2–3 weekends. This is where the strategy becomes visible.**

- **Errors as retry-fuel:** rewrite every NxError to the tool-error standard — what was wrong, where, what valid looks like. `"mesh key must be a string: got number 1 at line 4 — write { \"1\": ... } or [expr]: ..."`. Then MEASURE it: eval harness adds a retry loop (model sees error, gets one fix attempt); track first-try vs post-retry pass rate. Error quality now has a number.
- **The spec-as-prompt artifact:** `NX_PROMPT.md` — the spec distilled for a context window: grammar, semantics, fence rules, 10 canonical examples, the 5 traps. This file is a first-class product deliverable, versioned with the language. Test it: eval runs use ONLY this file, not the full spec.
- **Canonical corpus:** 50 idiomatic Nx programs (the eval solutions, cleaned + annotated). Serves as few-shot material, documentation examples, and — if Nx ever earns fine-tuning — the seed dataset.
- **`nx fix` (stretch):** feed a failed run's source + error to a model with NX_PROMPT and apply the patch. Dogfoods the whole thesis in one command.

**Acceptance:** post-retry pass rate ≥ 95% frontier / ≥ 75% mid-tier on golden set; NX_PROMPT ≤ 6K tokens and passes evals standalone.

---

## PHASE 6 — CONCURRENCY: FINISH OR CUT (decide, don't drift)
**~2 weekends if finishing the short list; 1 evening if cutting.**

The spec's §17 lists designed-but-unbuilt items. 1.0 discipline: each one gets built or moved to a "post-1.0, maybe never" list — nothing stays "coming."

- **Build (recommended):** channel `select` with timeout, closeable channels. These complete the fiber story to minimally-useful; agent code genuinely needs timeout-or-value.
- **Cut (recommended):** suspension across called-agent boundaries, worker pools, inter-task channels. Real engineering cost, marginal for the niche; the current clean errors already say "not supported" honestly.

**Acceptance:** §17 is empty or renamed "Out of scope (final)"; whatever shipped has fence-grade tests.

---

## PHASE 7 — NEXUS INTEGRATION (dogfood or die)
**Runs in parallel from Phase 3 onward; 30-day soak before 1.0.**

- Port three real Nexus behaviors to Nx: (1) an intent-routing policy, (2) an EOD data-shaping pipeline, (3) one fenced tool-calling routine with budgets (the spend cap demo is the flagship — `needs spend(max 5, total 15)` guarding a real action is the whole pitch in one line).
- Nexus embeds via `nx-run.js` allowlist host; every audit ledger flows into Nexus's SQLite log.
- Keep a friction journal: every time writing real Nx annoys you or a model, it's an issue. The journal drains into Phases 2/5 while they're still open.

**Acceptance:** 30 consecutive days, three policies live, zero language-caused incidents, friction journal empty or deferred-with-reasons.

---

## PHASE 8 — SPEC 2.0 + DOCS (the freeze)
**~2 weekends.**

- **Spec 2.0:** current spec + all Phase 2–6 changes, re-edited to the same honest voice, token-counted, frozen. Semver from here: 2.x additive only, breaking = 3.0 = probably never.
- **Docs site (single static page is fine):** the pitch (safe substrate thesis + SECURITY.md), 15-minute tutorial, the spec, NX_PROMPT download, the eval scoreboard (public numbers — your credibility artifact), embed guide.
- **README rewrite** around the mission sentence, with the spend-cap demo above the fold.

**Acceptance:** a stranger can go from zero → embedded fenced script in 15 minutes using only the docs; every claim in the docs traces to a test or an eval number.

---

## PHASE 9 — SHIP
**1 weekend.**

- npm publish (`nx-lang` or nearest available name — check now, squat early), GitHub public with license (MIT recommended for adoption; the moat is the eval-driven design process and your velocity, not the code).
- Launch posts where the actual audience lives: r/LocalLLaMA (the fence + local-model eval numbers ARE the hook), Hacker News (Show HN), lobste.rs. Lead with the scoreboard and the spend-cap demo, not the language tour.
- 1.0 tag = the Definition of Done checklist, checked, in the release notes.

---

## PHASE 10 — MAINTENANCE MODE (staying finished)
**Written policy, ~1 evening.**

- Fixed: crashes, fence bypasses, spec/implementation divergence, eval regressions.
- Considered: additive stdlib natives that don't grow NX_PROMPT.
- Refused by default: syntax, semantics, new paradigms. The spec being frozen IS the feature.
- Cadence: issues triaged weekly (30 min), patch releases as needed, eval suite re-run against new frontier models quarterly (free marketing when numbers improve without you touching anything).

---

## TIMELINE (honest, at real availability)

Assuming ~8–10 focused hours/week alongside the stores, Nexus, and the SaaS:

| Phase | Elapsed |
|---|---|
| 1 Eval harness | Weeks 1–3 |
| 2 Breaking changes | Weeks 4–7 |
| 3 Fence completion | Weeks 8–10 |
| 4 Robustness | Weeks 11–13 |
| 5 AI ergonomics | Weeks 14–16 |
| 6 Concurrency decide | Week 17 |
| 7 Nexus soak | Weeks 8–20 (parallel) |
| 8 Spec 2.0 + docs | Weeks 18–20 |
| 9 Ship | Week 21 |

**~5 months to 1.0.** Double it if the SaaS takes priority (it should when they conflict — see kill criteria). Git-from-minute-one, one phase per branch, no phase merges without its acceptance line checked.

---

## RISKS & KILL CRITERIA (pre-committed, so future-you doesn't negotiate)

- **Eval delta never materializes:** if after Phase 5 a frontier model writes fenced Python-in-a-sandbox as reliably as Nx for the same tasks, the thesis is weaker than believed → finish Phase 7 only (Nx stays as Nexus's policy DSL, a fine outcome) and skip 8–9. Decision point: end of Phase 5, by the numbers.
- **Time competition:** the vendor SaaS is the wealth vehicle; Nx is leverage and craft. Any week both need the same hours, SaaS wins. Nx phases are sized to survive interruption (each phase is independently valuable and git-frozen).
- **Scope creep:** the spec token budget is the tripwire. NX_PROMPT > 6K tokens = stop, cut, reassess. Small is the strategy; the moment it isn't small, there is no strategy.
- **Solo-maintainer risk:** mitigated by maintenance mode's refusal posture and the frozen spec — a finished small language needs hours per month, not per week.
