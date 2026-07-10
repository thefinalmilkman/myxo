def make_counter(start=0):
    count = start

    def step():
        nonlocal count
        count += 1
        return count

    return step


def make_accumulator():
    total = 0

    def add(x):
        nonlocal total
        total += x
        return total

    return add
