assert same_contents([1, 2, 3], [1, 2, 3]) is True
# distinct objects with equal contents must still be equal
assert same_contents([1, 2, 3], [1, 2] + [3]) is True
assert same_contents([], []) is True
assert same_contents([1, 2, 3], [1, 2]) is False
assert same_contents([1, 2], [1, 2, 3]) is False
assert same_contents([1, 2, 3], [1, 3, 2]) is False  # order matters
assert same_contents([1, 2, 3], [1, 2, 4]) is False
assert same_contents(["a", "b"], ["a", "b"]) is True
assert same_contents(["a", "b"], ["a", "c"]) is False
assert same_contents([0], []) is False
assert same_contents([1], [1]) is True

print("ok")
