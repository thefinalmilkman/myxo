assert group_by_mod3([]) == {"0": [], "1": [], "2": []}
assert group_by_mod3([0, 1, 2]) == {"0": [0], "1": [1], "2": [2]}
assert group_by_mod3([3, 6, 9]) == {"0": [3, 6, 9], "1": [], "2": []}
assert group_by_mod3([1, 4, 7]) == {"0": [], "1": [1, 4, 7], "2": []}
# order preserved within group
assert group_by_mod3([9, 3, 6]) == {"0": [9, 3, 6], "1": [], "2": []}
assert group_by_mod3([0, 3, 1, 4, 2, 5]) == {"0": [0, 3], "1": [1, 4], "2": [2, 5]}
# overlapping shape: same numbers different order
assert group_by_mod3([5, 2, 4, 1]) == {"0": [], "1": [4, 1], "2": [5, 2]}
assert group_by_mod3([2, 5, 1, 4]) == {"0": [], "1": [1, 4], "2": [2, 5]}
# keys always present
r = group_by_mod3([10])
assert set(r.keys()) == {"0", "1", "2"}
assert r == {"0": [], "1": [10], "2": []}
print("ok")
