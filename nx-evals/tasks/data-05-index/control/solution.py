def index_by_id(records):
    out = {}
    for r in records:
        out[str(r["id"])] = r["name"]
    return out
