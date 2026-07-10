def count_distinct(ks):
    seen = set()
    for k in ks:
        seen.add(str(k))
    return len(seen)
