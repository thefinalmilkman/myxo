def tally(label="total", *nums):
    return label + ": " + str(sum(nums))


def adder3(a):
    return lambda b: lambda c: a + b + c
