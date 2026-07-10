# all falsy values fall back, not just None
assert with_default(0, 99) == 99
assert with_default("", "def") == "def"
assert with_default([], [1]) == [1]
assert with_default({}, {"a": 1}) == {"a": 1}
assert with_default(None, 99) == 99
# truthy values are kept
assert with_default(5, 99) == 5
assert with_default("hi", "def") == "hi"
assert with_default([1, 2], [9]) == [1, 2]
assert with_default({"k": 1}, {}) == {"k": 1}
assert with_default(-1, 99) == -1  # nonzero number is truthy

print("ok")
