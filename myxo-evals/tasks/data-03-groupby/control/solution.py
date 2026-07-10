def group_by_mod3(xs):
    out = {"0": [], "1": [], "2": []}
    for x in xs:
        out[str(x % 3)].append(x)
    return out
