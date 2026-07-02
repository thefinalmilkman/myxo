# Nx Evals — First Baseline (Phase 1)

_First numbers, however ugly (the ROADMAP's Phase-1 acceptance line). Committed as the honest
starting point; re-run and append as the language and the spec evolve._

Generated 2026-07-02. Harness: `run-evals.js` (Nx) + `run-control.js` (Python control), two-agent-gated.

## The golden set

**30 tasks**, 5 per bucket: `data` · `control` · `agents` · `fence` · `concurrency` · `adversarial`.
Reference solutions validate the set and the harness:

| Run | Result |
|---|---|
| `run-evals.js` (--ref, Nx reference solutions) | **30/30** ✅ |
| `run-control.js` (--ref, Python reference solutions) | **20/20** ✅ (10 fence/concurrency tasks excluded — see Scope) |

## First model baselines

The product metric is the **Nx-vs-Python delta on one model**: can a model write correct code
more reliably in Nx than in Python? Measured on the one tier that runs for free today.

| Model | Nx (30 tasks) | Python control (20 pure-compute tasks) |
|---|---|---|
| `qwen2.5-coder:7b` (local, free) | **0/30 (0%)** | **18/20 (90%)** |
| frontier (`claude-opus-4-8`) | — blocked (see below) | — blocked |

### What the numbers say (honest read)

- **A 7B local model writes Python at 90% but cannot produce valid Nx at all (0%).** The Nx
  failures are 29 parse errors + 1 missing-construct — the model defaults to the C/Python
  syntax it knows (semicolons, dot-access) that Nx doesn't use. It never gets far enough to
  be judged on semantics.
- **This is a floor signal, not a verdict on the thesis.** It says the mid/small tier needs
  the language spec delivered as a prompt-optimized artifact (the ROADMAP's Phase-5
  `NX_PROMPT` — a distilled spec + canonical examples + the traps), *or* that 7B is simply
  below the floor for a from-scratch language. The frontier baseline (blocked, below) is the
  real thesis test.
- **The 2 Python failures** (`agents` 4/5, `control` 4/5) show the 7B model isn't a perfect
  Python writer either — the control is a fair, non-trivial bar, not a gimme.

### Frontier tier — blocked on API credits

`--model claude` is fully wired (`generators/claude.js`, via the claude-api skill) and
**proven reachable** — it connects to `api.anthropic.com` and returns a real API response.
That response is currently `credit balance is too low`: the `ANTHROPIC_API_KEY` in use has an
empty balance. This is an infrastructure blocker, not a code bug. The moment the key has
credit (or a funded key is supplied via `ANTHROPIC_API_KEY`), `node nx-evals/run-evals.js
--model claude` and `node nx-evals/run-control.js --model claude` produce the frontier
Nx-vs-Python delta — the ROADMAP's first real thesis verdict.

## Scope & honesty notes

- **Model-blind measurement.** Generators send the model only the spec (Nx) or nothing (Python)
  plus the prompt — never the checks. So the "hardcode the checked outputs" attack the
  verification adversary demonstrated is not a real measurement threat; checks were still
  thickened with overlapping-shape cases as defense-in-depth.
- **No Python control for fence & concurrency (10 tasks).** These are the Nx-differentiated
  buckets: Python has no language-level capability fence, and Nx's isolation-based concurrency
  model doesn't map to a fair plain-Python control. `run-control.js` reports these as `SKIP`
  and excludes them from the control total (never silently). That absence *is* part of the
  thesis — it's the moat.
- **Harness trust.** `run-evals.js` was hardened by two independent adversarial passes and its
  fixes pinned by `test/evals.test.js` (18 regressions): fence tasks scored on the audit ledger
  (not stdout), fuel-bounded execution, dead-branch/comment/string-proof construct gate,
  self-test stripping, parse-first classification. See the ROADMAP Phase-1 completion note.

## Reproduce

```
node nx-evals/run-evals.js                                   # 30/30 (validates the set)
NX_EVAL_OLLAMA_MODEL=qwen2.5-coder:7b node nx-evals/run-evals.js --model ollama
NX_EVAL_OLLAMA_MODEL=qwen2.5-coder:7b node nx-evals/run-control.js --model ollama
ANTHROPIC_API_KEY=<funded-key> node nx-evals/run-evals.js --model claude   # when credit is available
```

Per-run rows (with model provenance) accrue in `results/*.jsonl` (gitignored — this file is the
committed record).
