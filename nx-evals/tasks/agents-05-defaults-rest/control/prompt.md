Define two functions:
- `tally(label="total", *nums)` — combines a default first parameter with `*args` rest parameters. It sums all the `nums` and returns the string `"<label>: <sum>"`. Called with no arguments it returns `"total: 0"`; `tally("sum", 10, 20)` returns `"sum: 30"`.
- `adder3(a)` — a curried chain of three single-argument functions: `adder3(a)(b)(c)` returns `a + b + c`.