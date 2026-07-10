# myxo-evals — the Myxo eval harness (Phase 1)

The instrument. Everything in the Road to 1.0 (`../ROADMAP.md`) claims to make Myxo more AI-writable; this is the only thing that can *prove* it.

## Run

```
node run-evals.js                 # --ref: run each task's reference solution (validates golden set + harness)
node run-evals.js --model ollama  # local FREE baseline (Ollama on :11434; NX_EVAL_OLLAMA_MODEL to pick model)
node run-evals.js --model claude  # frontier tier (opt-in; ANTHROPIC_API_KEY; costs — generator stubbed, see generators/claude.js)
```

Exit 0 = all pass. Prints a per-bucket scoreboard; writes `results/<model>.jsonl` (one row per task: ts, model, task, bucket, pass, errClass, detail).

## Task format

`tasks/<bucket>-NN-<name>/`:
- `prompt.md` — the task text handed to the model (spec is prepended automatically).
- `solution.myx` — the **reference** solution (proves the task is solvable; used by `--ref`).
- **one checker:**
  - `check.myx` — Myxo `test`/`expect` blocks referencing the solution's agents (run via `nx.runTests`), **or**
  - `expected.txt` (+ optional `host.js` exporting `{ natives }`) — the solution is run via `nx.run` (host grants natives, `requireManifest` on) and captured stdout must match.

## Buckets (5 tasks each → 30 golden; seeded with 1 each here — expand)

1. **data** — parse/filter/transform lists & meshes
2. **control** — match, loops, attempt/rescue
3. **agents** — recursion, defaults, rest params, closures, pipelines
4. **fence** — needs manifests, budgets, correct denial handling
5. **concurrency** — dispatch/gather, fibers/channels
6. **adversarial** — the footguns: newline gluing, mesh-key coercion, identity equality

## The control group (next)

The product metric is the **Python delta**: the same 30 tasks written by the same model in Python-in-a-sandbox. If a model writes safe Python as reliably as Myxo, the thesis is weaker than believed (see ROADMAP kill criteria). Wire a `python` scorer + `generators/*` python path to produce it.

## Cost discipline

Frontier tier = the Claude key we already have (`ANTHROPIC_API_KEY`); mid/small tier = local Ollama (free). The harness must never be blocked on a bill.
