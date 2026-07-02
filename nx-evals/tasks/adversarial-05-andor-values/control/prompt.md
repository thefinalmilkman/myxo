Define two functions that rely on `and`/`or` returning VALUES, not booleans:
- `first_truthy(a, b, c)` — returns the first of `a, b, c` that is truthy, using `a or b or c`. `first_truthy(0, "found", 3)` returns the string `"found"` (NOT `True`). If all three are falsy it returns the last one.
- `last_if_all(a, b, c)` — returns `a and b and c`: the last value if all are truthy, otherwise the first falsy one encountered. `last_if_all(1, 0, 3)` returns `0`.

Return the actual operand value, not a coerced boolean.