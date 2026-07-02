assert word_freq("") == {}
assert word_freq("a") == {"a": 1}
assert word_freq("a a a") == {"a": 3}
assert word_freq("a b c") == {"a": 1, "b": 1, "c": 1}
assert word_freq("the cat the dog the") == {"the": 3, "cat": 1, "dog": 1}
# overlapping shape: same words different counts
assert word_freq("x y x y y") == {"x": 2, "y": 3}
assert word_freq("x y x y x") == {"x": 3, "y": 2}
# case sensitive distinct keys
assert word_freq("A a A") == {"A": 2, "a": 1}
# single repeated pair
assert word_freq("hi hi") == {"hi": 2}
print("ok")
