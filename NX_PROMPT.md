# Nx — write this language (prompt card)

Nx is a small scripting language. You will be given a task; return ONLY Nx code. Nx is NOT Python, NOT
JavaScript, NOT C — do not assume their syntax. Learn it from the rules and examples below, then write.

## The 6 rules you must not break

1. **NO SEMICOLONS. EVER.** Statements end at the end of the line — never write `;`. `seed x = 1` then a
   newline. A `;` is a syntax error.
2. **Booleans are `live` and `dead`** — never `true`/`false`. `report live`, `when x { ... }`.
3. **Functions are `agent`s; return with `report`.** `agent add(a, b) { report a + b }`. No `function`, no
   `def`, no `return`, no `=>` for statements.
4. **Declare a variable with `seed`, reassign with plain `=`.** `seed n = 0` then later `n = n + 1`.
5. **`==` on two lists or two meshes compares IDENTITY, not contents** — `[1,2] == [1,2]` is `dead`. Compare
   length + elements yourself. (Inside `match`/`expect`, equality IS structural.)
6. **Mesh keys are strings.** `{ "a": 1 }`. The number `1` and the string `"1"` are the SAME key.

## Core syntax by example (imitate these)

```nx
# variables, agents, report
seed name = "Zero"
agent greet(who) { report "hi " + who }

# conditionals — `when` / `otherwise`, blocks in { }
agent sign(n) {
  when n > 0 { report "pos" }
  otherwise when n < 0 { report "neg" }
  otherwise { report "zero" }
}

# loop over a list, mesh (keys), or string (chars)
agent total(xs) {
  seed s = 0
  for each x in xs { s = s + x }
  report s
}

# while-loop is `reinforce COND { }`; repeat is `reinforce N times { }`
agent countdown(n) {
  reinforce n > 0 { emit n  n = n - 1 }
}

# lists and meshes
seed nums = [1, 2, 3]
seed person = { "name": "Zero", "age": 30 }
emit person["name"]              # index a mesh by key, a list by integer (negatives from end: xs[0-1] = last)
seed longer = nums + [4]         # + concatenates two lists; + concatenates if EITHER side is a string
seed n = len(nums)               # len works on list/mesh/string

# default + rest params, and closures
agent log(msg, level = "info", ...rest) { report level + ": " + msg }
agent adder(k) { report agent(x) { report x + k } }   # returns a closure

# pattern matching — `match` (first arm whose shape fits runs)
agent describe(v) {
  match v {
    [] { report "empty" }
    [x] { report "one" }
    { "kind": k } { report k }      # mesh that HAS key "kind"; binds k
    _ { report "other" }            # wildcard
  }
}

# errors — attempt / rescue, and fail
agent safe_div(a, b) {
  attempt { report a / b } rescue e { report "undefined" }   # e is a mesh { message, line, value }
}

# pipeline: x | f  ==  f(x) ; x | f(a) == f(x, a)  (piped value is the FIRST arg)
agent inc(x) { report x + 1 }
seed y = 5 | inc | inc          # 7
```

## Truthiness & and/or (these trip up Python/JS habits)

- **Dead (falsy):** `void`, `0`, `""`, empty list `[]`, empty mesh `{}`. Everything else is live.
- **`and`/`or` return a VALUE, not a bool** (and short-circuit): `a or b` → `a` if `a` is live, else `b`.
  So `x or default` gives a fallback. `a and b` → `a` if `a` is dead, else `b`.

```nx
agent with_default(v, fallback) { report v or fallback }   # 0/""/[] all fall back, not just void
```

## The capability fence (only when the task mentions natives / a manifest / budgets)

A script reaches the host ONLY through granted natives, and must DECLARE them with `needs` at the top.

```nx
needs lookup, spend(max 5, total 15)     # spend is budgeted: max per call, total cumulative

seed r = lookup("x")
emit "got: " + r
attempt {
  spend(9)                               # over the max-5 cap -> the fence refuses it
  emit "spent"
} rescue e {
  emit "blocked"                         # a fence denial is catchable like any error
}
```

Calling a native you did not `needs`-declare is refused even if the host granted it.

## Concurrency (only when the task asks for parallel / fibers / channels)

```nx
# parallel: dispatch builds a task, gather runs them on real threads, results in order
agent sq(n) { report n * n }
agent squares(xs) {
  seed tasks = []
  for each x in xs { tasks = tasks + [dispatch sq(x)] }
  report gather tasks
}

# fibers + channels (one thread, cooperative): spawn / give..to / take..from / await
agent producer(c, xs) { for each x in xs { give x to c } }
agent consumer(c, n) { seed s = 0  reinforce n times { take v from c  s = s + v }  report s }
agent sum_via_channel(xs) {
  seed ch = channel()
  spawn producer(ch, xs)
  seed job = spawn consumer(ch, len(xs))
  report await(job)
}
```

## The 5 traps (right vs wrong)

| Trap | WRONG (a Python/JS habit) | RIGHT (Nx) |
|---|---|---|
| Semicolons | `seed x = 1;` | `seed x = 1` (newline ends it) |
| Booleans | `report true` | `report live` |
| List equality | `report a == b` | compare `len` + each element in a loop |
| Mesh keys collide | assuming `1` ≠ `"1"` as keys | they are the SAME key (keys coerce to strings) |
| Fallback only on null | `when v == void { ... }` | `v or fallback` (0/""/[] are also dead) |

## How to answer

Return ONE ```nx code block. Define exactly the agent(s) the task names — no extra prose, no `main`, no
semicolons. Prefer the patterns above; when unsure, keep it simple and let `report` return the value.
