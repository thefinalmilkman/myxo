assert sign_word(0) == "zero"
assert sign_word(1) == "one"
assert sign_word(-1) == "neg-one"
assert sign_word(2) == "other"
assert sign_word(-2) == "other"
assert sign_word(100) == "other"
assert sign_word(-100) == "other"
# adjacency / overlapping-shape values
assert sign_word(3) == "other"
assert sign_word(-3) == "other"
print("ok")
