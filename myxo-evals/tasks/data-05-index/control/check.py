assert index_by_id([]) == {}
assert index_by_id([{"id": 1, "name": "a"}]) == {"1": "a"}
assert index_by_id([{"id": 1, "name": "a"}, {"id": 2, "name": "b"}]) == {"1": "a", "2": "b"}
# later wins on duplicate id
assert index_by_id([{"id": 1, "name": "a"}, {"id": 1, "name": "z"}]) == {"1": "z"}
# id coerced to string key
assert index_by_id([{"id": 10, "name": "x"}]) == {"10": "x"}
# string id already
assert index_by_id([{"id": "k", "name": "v"}]) == {"k": "v"}
# overlapping shape: same names different ids
assert index_by_id([{"id": 1, "name": "a"}, {"id": 2, "name": "a"}]) == {"1": "a", "2": "a"}
# same ids different names, later wins
assert index_by_id([{"id": 5, "name": "first"}, {"id": 5, "name": "second"}, {"id": 5, "name": "third"}]) == {"5": "third"}
# mixed
assert index_by_id([{"id": 1, "name": "a"}, {"id": 2, "name": "b"}, {"id": 1, "name": "c"}]) == {"1": "c", "2": "b"}
print("ok")
