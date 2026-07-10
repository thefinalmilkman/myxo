Define three functions, each most naturally written with recursion:
- `sum_to(n)` — returns the sum of the integers from `1` to `n` (and `0` when `n <= 0`).
- `fib(n)` — the nth Fibonacci number, where `fib(0)` is `0` and `fib(1)` is `1`.
- `gcd(a, b)` — the greatest common divisor of `a` and `b`, computed by the Euclidean algorithm (recurse on `gcd(b, a % b)` until `b` is `0`).