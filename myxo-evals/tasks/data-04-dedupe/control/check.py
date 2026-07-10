assert dedupe([]) == []
assert dedupe(["a"]) == ["a"]
assert dedupe(["a", "a", "a"]) == ["a"]
assert dedupe(["a", "b", "c"]) == ["a", "b", "c"]
assert dedupe(["a", "b", "a", "c", "b"]) == ["a", "b", "c"]
# first-seen order matters
assert dedupe(["c", "b", "a", "c", "a"]) == ["c", "b", "a"]
# overlapping shape: same elements different order -> different result
assert dedupe(["x", "y", "x"]) == ["x", "y"]
assert dedupe(["y", "x", "y"]) == ["y", "x"]
# case sensitivity
assert dedupe(["A", "a", "A"]) == ["A", "a"]
# adjacent dup
assert dedupe(["p", "p", "q", "q"]) == ["p", "q"]
print("ok")
