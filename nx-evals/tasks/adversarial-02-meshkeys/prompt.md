Define an agent `count_distinct(ks)` that takes a list `ks` and returns how many DISTINCT keys it holds when each element is used as a mesh key.

TRAP: in Nx, mesh keys are coerced to strings — the number `1` and the string `"1"` are the SAME key. So `count_distinct([1, "1"])` is `1`, not `2`. A solution that compares elements with `==` (where a number and a string are never equal, being different kinds) will overcount. Use the mesh's own key coercion to collapse duplicates.
