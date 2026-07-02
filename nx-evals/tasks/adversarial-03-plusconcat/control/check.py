assert numeric_sum([1, "2", 3]) == 4
assert numeric_sum([1, 2, 3]) == 6
assert numeric_sum(["1", "2", "3"]) == 0
assert numeric_sum([]) == 0
assert numeric_sum(["a", 10, "b", 5]) == 15
assert numeric_sum([100]) == 100
assert numeric_sum(["only text"]) == 0
assert numeric_sum([-5, "5", 5]) == 0
# result must be a number, not a concatenated string
r = numeric_sum([1, "2", 3])
assert isinstance(r, (int, float)) and not isinstance(r, str)
assert r == 4

print("ok")
