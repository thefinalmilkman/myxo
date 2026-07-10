# Myxo Evals — First Baseline (Phase 1)

_First numbers, however ugly (the ROADMAP's Phase-1 acceptance line). Committed as the honest
starting point; re-run and append as the language and the spec evolve._

Generated 2026-07-02. Harness: `run-evals.js` (Myxo) + `run-control.js` (Python control), two-agent-gated.

## The golden set

**30 tasks**, 5 per bucket: `data` · `control` · `agents` · `fence` · `concurrency` · `adversarial`.
Reference solutions validate the set and the harness:

| Run | Result |
|---|---|
| `run-evals.js` (--ref, Myxo reference solutions) | **30/30** ✅ |
| `run-control.js` (--ref, Python reference solutions) | **20/20** ✅ (10 fence/concurrency tasks excluded — see Scope) |

## First model baselines

The product metric is the **Myxo-vs-Python delta on one model**: can a model write correct code
more reliably in Myxo than in Python? Measured on the one tier that runs for free today.

| Model | Myxo — full `SPEC.md` | Myxo — `MYXO_PROMPT.md` (Phase 5) | Python control |
|---|---|---|---|
| `qwen2.5-coder:7b` (local, free) | **0/30 (0%)** | **19/30 (63%)** | **18/20 (90%)** |
| frontier (`claude-opus-4-8`) | — blocked | — blocked | — blocked |

### ⭐ The MYXO_PROMPT lift: 0/30 → 19/30 (Phase 5 confirmed on the local tier)

The 0/30 with the full 5,087-token `SPEC.md` was **29 parse errors** — the 7B defaulted to C-style
semicolons the whole time. `MYXO_PROMPT.md` (Phase 5's distilled teaching prompt — **1,316 tokens**,
examples-first, the traps as imperatives, "NO SEMICOLONS. EVER." rule #1) fixed it: the **same model,
same tasks, same machine** jumped to **19/30 (63%)**. The floor was never the model — it was the document.
Per bucket: adversarial **5/5** (it nails the footguns — identity equality, mesh-key coercion, +concat,
truthiness), control **5/5**, concurrency 4/5, agents 3/5, data 2/5, **fence 0/5** (the manifest+budget+
refusal bucket is the hardest to teach a small model — honest, and thesis-relevant: the moat is exactly
where a 7B still needs richer examples or the frontier tier). Reproduce: `NX_EVAL_SPEC=prompt
NX_EVAL_OLLAMA_MODEL=qwen2.5-coder:7b node myxo-evals/run-evals.js --model ollama`.

### What the numbers say (honest read)

- **The document, not the model, was the floor.** With the full spec a 7B writes Python at 90% but
  scored **0/30** on Myxo (29 parse errors — C-style semicolons). Handed `MYXO_PROMPT.md` instead, the same
  model reached **19/30 (63%)** — the Phase-5 artifact was the missing piece, confirmed on the free tier.
  It now clears the entire adversarial (footgun) bucket; only the fence bucket (0/5) resists a 7B.
- **The earlier framing below is kept for the record but superseded by the MYXO_PROMPT result.**
- **This was a floor signal, not a verdict on the thesis.** It said the mid/small tier needs
  the language spec delivered as a prompt-optimized artifact (the ROADMAP's Phase-5
  `MYXO_PROMPT` — a distilled spec + canonical examples + the traps), *or* that 7B is simply
  below the floor for a from-scratch language. The frontier baseline (blocked, below) is the
  real thesis test.
- **The 2 Python failures** (`agents` 4/5, `control` 4/5) show the 7B model isn't a perfect
  Python writer either — the control is a fair, non-trivial bar, not a gimme.

### Frontier tier — blocked on API credits

`--model claude` is fully wired (`generators/claude.js`, via the claude-api skill) and
**proven reachable** — it connects to `api.anthropic.com` and returns a real API response.
That response is currently `credit balance is too low`: the `ANTHROPIC_API_KEY` in use has an
empty balance. This is an infrastructure blocker, not a code bug. The moment the key has
credit (or a funded key is supplied via `ANTHROPIC_API_KEY`), `node myxo-evals/run-evals.js
--model claude` and `node myxo-evals/run-control.js --model claude` produce the frontier
Myxo-vs-Python delta — the ROADMAP's first real thesis verdict.

## Scope & honesty notes

- **Model-blind measurement.** Generators send the model only the spec (Myxo) or nothing (Python)
  plus the prompt — never the checks. So the "hardcode the checked outputs" attack the
  verification adversary demonstrated is not a real measurement threat; checks were still
  thickened with overlapping-shape cases as defense-in-depth.
- **No Python control for fence & concurrency (10 tasks).** These are the Myxo-differentiated
  buckets: Python has no language-level capability fence, and Myxo's isolation-based concurrency
  model doesn't map to a fair plain-Python control. `run-control.js` reports these as `SKIP`
  and excludes them from the control total (never silently). That absence *is* part of the
  thesis — it's the moat.
- **Harness trust.** `run-evals.js` was hardened by two independent adversarial passes and its
  fixes pinned by `test/evals.test.js` (18 regressions): fence tasks scored on the audit ledger
  (not stdout), fuel-bounded execution, dead-branch/comment/string-proof construct gate,
  self-test stripping, parse-first classification. See the ROADMAP Phase-1 completion note.

## Reproduce

```
node myxo-evals/run-evals.js                                   # 30/30 (validates the set)
NX_EVAL_OLLAMA_MODEL=qwen2.5-coder:7b node myxo-evals/run-evals.js --model ollama
NX_EVAL_OLLAMA_MODEL=qwen2.5-coder:7b node myxo-evals/run-control.js --model ollama
ANTHROPIC_API_KEY=<funded-key> node myxo-evals/run-evals.js --model claude   # when credit is available
```

Per-run rows (with model provenance) accrue in `results/*.jsonl` (gitignored — this file is the
committed record).
