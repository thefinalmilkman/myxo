assert sum_to(0) == 0
assert sum_to(-5) == 0
assert sum_to(1) == 1
assert sum_to(5) == 15
assert sum_to(10) == 55
assert sum_to(100) == 5050

assert fib(0) == 0
assert fib(1) == 1
assert fib(2) == 1
assert fib(3) == 2
assert fib(7) == 13
assert fib(10) == 55

assert gcd(12, 8) == 4
assert gcd(8, 12) == 4
assert gcd(17, 5) == 1
assert gcd(100, 10) == 10
assert gcd(0, 9) == 9
assert gcd(9, 0) == 9
assert gcd(270, 192) == 6

print("ok")
