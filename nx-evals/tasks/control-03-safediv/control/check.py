assert safe_div(10, 2) == 5
assert safe_div(9, 3) == 3
assert safe_div(1, 0) == "undefined"
assert safe_div(0, 0) == "undefined"
assert safe_div(-6, 2) == -3
assert safe_div(7, 2) == 3.5
assert safe_div(0, 5) == 0
# zero divisor overrides otherwise-normal-looking inputs
assert safe_div(100, 0) == "undefined"
assert safe_div(-100, 0) == "undefined"
print("ok")
