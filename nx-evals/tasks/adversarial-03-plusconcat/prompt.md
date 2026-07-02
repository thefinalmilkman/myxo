Define an agent `numeric_sum(xs)` that returns the sum of only the NUMBER elements of the list `xs`, skipping any element that is a string. `numeric_sum([1, "2", 3])` is `4`.

TRAP: in Nx, `+` is overloaded — it adds two numbers, but if EITHER operand is a string it CONCATENATES (the other side is stringified). So a running total that blindly does `total + x` turns into string concatenation the moment `x` is a string (`1 + "2"` is `"12"`), corrupting the result. Guard each element by its `type` and only add the numbers. The result must be a number.
