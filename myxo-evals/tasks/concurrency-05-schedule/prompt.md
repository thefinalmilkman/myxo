Use the Physarum scheduler to distribute a batch across a worker pool. Define an agent `triples(xs)` that returns a new list with every number tripled, in the original order, computed in parallel via `schedule`.

Define a self-contained worker agent `worker(chunk)` that takes a **chunk** (a list of items), and returns a list of results — one per item, in order — where each result is the item times 3.

In `triples`, call `schedule("triplePool", [worker, worker], xs)` (a named pool of two workers over the batch `xs`) and return its result.

Examples: `triples([1, 2, 3])` is `[3, 6, 9]`; `triples([10, 20])` is `[30, 60]`; `triples([])` is `[]`.
