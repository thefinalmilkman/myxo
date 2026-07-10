Define an agent `cubeSum(xs)` that cubes every number in the list **in parallel** and returns the sum of the cubes. Cube each element with `dispatch`, collect the results with `gather`, then compose the gathered list through a `|` pipeline into a reducer that sums it.

Also define the worker agent `cube(n)` returning `n * n * n`, and the reducer `total(xs)` returning the sum of the list (`total([]) is 0`).

Examples: `cubeSum([1, 2, 3])` is `36`; `cubeSum([2, 2, 2])` is `24`; `cubeSum([])` is `0`.
