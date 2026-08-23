# AGENTS.md — nx-lang (Myxo)

## Multi-session lane protocol (the yield sign)

Multiple agent/human sessions work in this repo at once (e.g. two terminals). To avoid
crashing into each other, every session obeys this law:

1. **Know your name.** The user assigns each session a lane name (e.g. `terminal-a`,
   `terminal-b`). Use it in every `lane.js` call. If the `KIMI_LANE` environment
   variable is set (the duo launcher sets it), that IS your lane name — no need to ask.
   Otherwise, if you were never given one, ask.
2. **Claim before you edit.** Before modifying any file, run:
   `node tools/lane.js claim <file> --by <your-name> --why "<what you're doing>"`
   - Exit 0 → the lane is yours; proceed.
   - Exit 1 → **YIELD**. Another session holds it. Do NOT edit that file. Work on
     something else, or tell the user you're blocked on that lane.
3. **Batch edits = one claim.** List every file you intend to touch in a single `claim`
   call (the claim is all-or-nothing: if any lane is taken, none are held).
4. **Release when done.** As soon as the work lands (and tests pass):
   `node tools/lane.js release --all --by <your-name>`
   Do not hold lanes while idle. Do not release another session's lanes (`--force` is
   for the user, or a proven-dead session).
5. **Stale locks.** A crashed session leaves locks behind. `node tools/lane.js list`
   shows ages; `node tools/lane.js clear-stale --hours 6` sweeps anything older.
   Locks older than ~6h with no live session are presumed dead.
6. **Everything is timestamped.** Every claim, yield, release, refusal, force-break,
   and sweep is appended to `.lane/journal.jsonl` with a UTC ISO timestamp.
   `node tools/lane.js log --last 20` shows the recent record. When you finish a
   piece of work, it should be visible in the journal.
7. **Reading is always free.** No claim needed to read, search, or run tests that
   don't write repo files (background eval runs write only gitignored
   `myxo-evals/results/*.jsonl` — still claim `myxo-evals/BASELINE.md` before editing it).

Locks live in `.lane/` (gitignored) — they never enter version control.

## Honesty gate (Lucy)

Before any work in this repo is declared DONE, VERIFIED, or a number is repeated as fact,
dispatch the `lucy` subagent (defined in `.kimi-code/agents/lucy.md`) with: the exact list of
claims, and the evidence locations (files, result artifacts, commands). Lucy works from raw
evidence only, treats the claimant as unreliable, and returns VERIFIED / UNVERIFIED / FALSE
per claim with receipts. Her verdict is reported alongside the work — including when it is
unflattering. This is the standing form of the vault's verify-with-agents rule.

## Project conventions

- Pure Node, **zero dependencies** — this is the language's law; `tools/lane.js` included.
- Tests: `npm test` (core suite must stay green; eval baselines live in `myxo-evals/BASELINE.md`).
- The language/binary is **Myxo** (`myxo.js`); the dir name `nx-lang` is historical.
