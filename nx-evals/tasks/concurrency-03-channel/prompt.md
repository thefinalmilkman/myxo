Using cooperative concurrency (fibers + a channel), define an agent `sumViaChannel(xs)` that returns the sum of the list.

Structure it as a producer/consumer:
- a `producer(c, xs)` fiber that `give`s each element of `xs` to the channel `c`;
- a `consumer(c, count)` fiber that `take`s `count` values from `c`, accumulates their sum, and `report`s it.

In `sumViaChannel`, create a `channel()`, `spawn` the producer and the consumer (the consumer should take `len(xs)` values), then `await` the consumer fiber and return its reported sum.

Examples: `sumViaChannel([1, 2, 3])` is `6`; `sumViaChannel([5, 5, 5])` is `15`; `sumViaChannel([])` is `0`.
