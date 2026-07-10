Define two agents that rely on `and`/`or` returning VALUES, not booleans:
- `first_truthy(a, b, c)` — returns the first of `a, b, c` that is live, using `a or b or c`. `first_truthy(0, "found", 3)` returns the string `"found"` (NOT `live`). If all three are dead it returns the last one.
- `last_if_all(a, b, c)` — returns `a and b and c`: the last value if all are live, otherwise the first dead one encountered. `last_if_all(1, 0, 3)` returns `0`.

TRAP: in Myxo, `and`/`or` short-circuit and yield one of their OPERANDS, not a coerced `live`/`dead`. Returning a boolean instead of the actual value is wrong.
