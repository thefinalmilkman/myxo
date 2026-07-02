assert tally() == "total: 0"
assert tally("sum", 10, 20) == "sum: 30"
assert tally("x") == "x: 0"
assert tally("nums", 1, 2, 3, 4) == "nums: 10"
assert tally("neg", -5, 5) == "neg: 0"
assert tally("total", 7) == "total: 7"

assert adder3(1)(2)(3) == 6
assert adder3(0)(0)(0) == 0
assert adder3(-1)(1)(10) == 10
assert adder3(100)(20)(3) == 123

print("ok")
