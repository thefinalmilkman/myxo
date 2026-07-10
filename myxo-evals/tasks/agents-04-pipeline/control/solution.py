def double(x):
    return x * 2


def inc(x):
    return x + 1


def process(x):
    return inc(double(x))


def apply_map(f, xs):
    return [f(x) for x in xs]
