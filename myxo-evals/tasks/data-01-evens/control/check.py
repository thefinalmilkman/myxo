assert evens_doubled([]) == []
assert evens_doubled([1, 3, 5]) == []
assert evens_doubled([2, 4, 6]) == [4, 8, 12]
assert evens_doubled([1, 2, 3, 4, 5, 6]) == [4, 8, 12]
assert evens_doubled([0]) == [0]
assert evens_doubled([7, 8, 9, 10]) == [16, 20]
# order preservation with interleaving
assert evens_doubled([10, 1, 2, 3, 4]) == [20, 4, 8]
# negative evens
assert evens_doubled([-2, -3, -4]) == [-4, -8]
# single odd
assert evens_doubled([11]) == []
# overlapping shape: same length/similar values, different content
assert evens_doubled([2, 2, 2]) == [4, 4, 4]
assert evens_doubled([1, 2, 2]) == [4, 4]
print("ok")
