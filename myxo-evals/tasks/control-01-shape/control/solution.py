def describe(v):
    if isinstance(v, list):
        if len(v) == 0:
            return "empty"
        if len(v) == 1:
            return "one"
        return "other"
    if isinstance(v, dict):
        if "kind" in v:
            return v["kind"]
        return "other"
    return "other"
