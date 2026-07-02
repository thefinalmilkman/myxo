Define an agent `describe(v)` using a `match` statement that returns:
- `"empty"` when `v` is an empty list `[]`
- `"one"` when `v` is a list with exactly one element
- the value at key `"kind"` when `v` is a mesh containing a `"kind"` key
- `"other"` for anything else
