add5 = adder(5)
assert add5(0) == 5
assert add5(10) == 15
assert adder(-3)(3) == 0
assert adder(0)(7) == 7
assert adder(100)(1) == 101

assert greet("World") == "Hello, World"
assert greet("Ann", "Hi") == "Hi, Ann"
assert greet("Bob", "Hey") == "Hey, Bob"
assert greet("X") == "Hello, X"

assert count() == 0
assert count(1) == 1
assert count(1, 2, 3) == 3
assert count("a", "b", "c", "d", "e") == 5
assert count(None, None) == 2

print("ok")
