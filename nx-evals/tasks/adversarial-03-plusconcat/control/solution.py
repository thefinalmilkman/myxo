def numeric_sum(xs):
    total = 0
    for x in xs:
        if isinstance(x, bool):
            continue
        if isinstance(x, (int, float)):
            total += x
    return total
