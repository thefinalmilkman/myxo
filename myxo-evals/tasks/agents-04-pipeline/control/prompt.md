Define these functions:
- `double(x)` — returns `x * 2`.
- `inc(x)` — returns `x + 1`.
- `process(x)` — returns `x` piped through `double` then `inc`. The piped value is the argument to each stage, so `process(5)` doubles to `10` then increments to `11`.
- `apply_map(f, xs)` — a higher-order function: returns a new list holding `f` applied to each element of the list `xs`, in order.