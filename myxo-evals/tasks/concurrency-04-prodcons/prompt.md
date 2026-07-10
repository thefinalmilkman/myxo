Build a three-stage fiber pipeline over **bounded** channels. Define an agent `doubleAll(xs)` that returns a new list with every element doubled, preserving order, by passing values through channels between fibers.

Stages:
- `source(out, xs)` — `give`s each element of `xs` to channel `out`;
- `doubler(inp, out, count)` — `take`s `count` values from `inp`, and `give`s each one doubled to `out`;
- `collect(inp, count)` — `take`s `count` values from `inp`, appends them to a list, and `report`s the list.

In `doubleAll`, create two **bounded** channels with `channel(2)` (so a fast producer applies backpressure), `spawn` the three stages wired `source -> a -> doubler -> b -> collect`, then `await` the collector and return its list.

Examples: `doubleAll([1, 2, 3])` is `[2, 4, 6]`; `doubleAll([])` is `[]`.
