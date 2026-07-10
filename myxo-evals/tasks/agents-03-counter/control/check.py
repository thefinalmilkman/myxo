c = make_counter()
assert c() == 1
assert c() == 2
assert c() == 3

c10 = make_counter(10)
assert c10() == 11
assert c10() == 12

# independence: two counters do not share state
a = make_counter()
b = make_counter()
assert a() == 1
assert a() == 2
assert b() == 1
assert a() == 3

acc = make_accumulator()
assert acc(0) == 0
assert acc(5) == 5
assert acc(10) == 15
assert acc(-3) == 12

acc2 = make_accumulator()
assert acc2(100) == 100
assert acc(1) == 13  # first accumulator unaffected

print("ok")
