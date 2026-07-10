# number 1 and string "1" collapse to the same key
assert count_distinct([1, "1"]) == 1
assert count_distinct([1, 2, 3]) == 3
assert count_distinct(["1", "2", "3"]) == 3
assert count_distinct([1, "1", 2, "2"]) == 2
assert count_distinct([]) == 0
assert count_distinct([5]) == 1
assert count_distinct([1, 1, 1]) == 1
assert count_distinct(["a", "b", "a"]) == 2
assert count_distinct([1, 2, "1", "2", 3]) == 3
assert count_distinct([10, "10", 10, "10"]) == 1

print("ok")
