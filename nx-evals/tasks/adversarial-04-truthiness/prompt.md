Define an agent `with_default(value, fallback)` that returns `value` when `value` is live, otherwise returns `fallback`. Use Nx's `or` short-circuit idiom.

TRAP: in Nx, `void`, `0`, `""`, the empty list `[]`, and the empty mesh `{}` are ALL dead (falsy) — not just `void`. So `with_default(0, 99)` must return `99`, and `with_default("", "def")` must return `"def"`. A solution that only falls back on `void` (JS/`??` thinking) will wrongly keep `0`, `""`, `[]`, and `{}`.
