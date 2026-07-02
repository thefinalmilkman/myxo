assert count_ordered_pairs([], 0) == 0
# single element, i==j allowed
assert count_ordered_pairs([2], 4) == 1
assert count_ordered_pairs([2], 5) == 0
# [1,2,3] target 4: (1,3),(3,1),(2,2) -> 3
assert count_ordered_pairs([1, 2, 3], 4) == 3
# all ordered pairs incl i==j: [1,1] target 2 -> (0,0),(0,1),(1,0),(1,1) = 4
assert count_ordered_pairs([1, 1], 2) == 4
# no pairs
assert count_ordered_pairs([1, 2, 3], 100) == 0
# overlapping shape: same list different target
assert count_ordered_pairs([0, 0, 0], 0) == 9
assert count_ordered_pairs([0, 0, 0], 1) == 0
# target uses i==j
assert count_ordered_pairs([3, 1], 6) == 1
print("ok")
