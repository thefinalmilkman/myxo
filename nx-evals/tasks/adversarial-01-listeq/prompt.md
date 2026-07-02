Define an agent `same_contents(a, b)` that returns `live` if two lists have **equal contents** (same length, equal elements in order) and `dead` otherwise.

TRAP: in Nx, `==` on two lists compares **identity, not contents** — `[1,2,3] == [1,2,3]` is `dead` because they are different list objects. So you must compare length and elements yourself; a naive `report a == b` will fail.
