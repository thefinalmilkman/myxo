# or returns the actual first truthy operand, not a boolean
assert first_truthy(0, "found", 3) == "found"
assert first_truthy(1, 2, 3) == 1
assert first_truthy(0, 0, 3) == 3
assert first_truthy(0, 0, 0) == 0  # all falsy -> last
assert first_truthy("", "", "x") == "x"
assert first_truthy("a", "b", "c") == "a"

# and returns last if all truthy, else first falsy encountered
assert last_if_all(1, 0, 3) == 0
assert last_if_all(1, 2, 3) == 3
assert last_if_all(0, 2, 3) == 0
assert last_if_all(1, 2, 0) == 0
assert last_if_all("a", "b", "c") == "c"
assert last_if_all(5, 6, "") == ""

print("ok")
