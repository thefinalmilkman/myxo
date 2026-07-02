assert double(0) == 0
assert double(5) == 10
assert double(-4) == -8

assert inc(0) == 1
assert inc(10) == 11
assert inc(-1) == 0

assert process(5) == 11
assert process(0) == 1
assert process(-1) == -1
assert process(10) == 21

assert apply_map(double, [1, 2, 3]) == [2, 4, 6]
assert apply_map(inc, [1, 2, 3]) == [2, 3, 4]
assert apply_map(process, [5, 0]) == [11, 1]
assert apply_map(double, []) == []
assert apply_map(lambda v: v, [7]) == [7]

print("ok")
