def count_ordered_pairs(xs, target):
    count = 0
    for i in range(len(xs)):
        for j in range(len(xs)):
            if xs[i] + xs[j] == target:
                count += 1
    return count
