# How Nx Works

Nx has two jobs:

1. Be an independent language with its own source files, runtime behavior, standard library,
   tooling, and release path.
2. Connect useful external runtimes through fenced capabilities: rich bridges for runtimes like
   Python and Node, conditional bridges such as Perl when installed, and weaker executable/CLI
   bridges for compiled tools like C++, Rust, and Go binaries.

Those jobs are separate on purpose. Nx can run by itself. Foreign languages extend it; they do
not define it.

## 1. The Standalone Language Core

A `.nx` program is real Nx source. It is not translated into Python or C++ first.

```text
.nx source
  -> lexer.js
  -> parser.js
  -> AST
  -> interpreter.js
  -> output + value + audit ledger
```

Current implementation:

- `lexer.js` tokenizes Nx source.
- `parser.js` builds the AST.
- `interpreter.js` walks the AST and enforces Nx semantics.
- `builtins.js` installs the core standard functions.
- `std.nx` is a self-hosted standard library written in Nx.
- `nx.js` is the CLI, REPL, formatter entrypoint, and Node embed API.

That means these are Nx language behavior, not aliases over another runtime:

- `seed` creates a pathway.
- `agent` defines a callable Nx function.
- `report` returns from an agent.
- `reinforce` loops.
- `decay` removes a pathway.
- `attempt` / `rescue` handle failures.
- `needs` declares external capabilities.
- pathway strength rises when names are read.
- routing and mesh behavior live in the interpreter.

The reference engine is currently written in Node. That is an implementation fact, not the
language identity. The independence path is to keep this Node tree-walker as the reference
while tightening a spec and eventually adding bytecode/native or other host runtimes.

## 2. Values And Execution

Nx values are intentionally small and portable:

- numbers
- strings
- `live` / `dead`
- `void`
- lists
- meshes
- agents

The interpreter stores named values in environments. A named value is a pathway. Reading a
pathway reinforces it by increasing its strength. `mesh()`, `strength(name)`, `prune()`, and
`metabolize()` expose that behavior to Nx code.

Agents are closures over their environment. The runtime can hot-promote pure agents by memoizing
calls it can prove safe: plain parameters, primitive arguments/results, no capabilities, no
observable side effects, no mutable outer-data dependency, and no stale global epoch.

## 3. Builtins vs Capabilities

Nx has a hard distinction:

- **Builtins** are ordinary language power: math, strings, lists, meshes, output, routing.
- **Capabilities** are host power: database calls, Telegram, Python, C++ binaries, shell,
  MCP tools, filesystem module loading, or anything outside the interpreter.

A capability does not exist inside a script unless the host registers it.

Even if the host registers it, production runners can require the script to declare it:

```nx
needs lookup, spend(max 5, total 15)

emit lookup("lead")
emit spend(4)
```

The production fence is:

```text
host allowlist
  -> script `needs` manifest
  -> value budget checks
  -> call execution
  -> audit ledger
```

If a script calls a capability it did not declare, Nx refuses before the host is touched. Every
allowed call and every refusal is recorded in the audit ledger.

Production runners also add operational limits:

- `requireManifest`: capability calls require `needs`.
- `maxSteps`: interpreter fuel for runaway loops.
- `timeoutMs`: live worker wall-clock timeout.
- `moduleLoader: null`: fences `weave` unless the host grants file loading.

## 4. Polyglot: How Python, C++, And Others Plug In

Polyglot support is foreign-function interface, not identity.

Nx sees every foreign language call as a capability:

```nx
needs pycall(total 3)

seed result = pycall("tools.py", "score", "lead-17")
emit result
```

The outer Nx law is the same whether the capability is implemented in Nx, Python, C++, Node, or
a remote tool:

```text
Nx script -> capability name -> host bridge -> foreign runtime -> Nx value
```

### Rich Runtime Bridge

`polyglot.js` currently has rich value-mapped runners for:

- Python: `pycall`, `pyeval`
- Node: `jscall`, `jseval`
- Perl: `plcall`, `pleval` when Perl is installed

These runners use a JSON/framed-result protocol so lists, meshes, numbers, strings, booleans,
and `void` can cross the boundary cleanly. Non-finite numbers are rejected instead of silently
becoming null. In the current machine test run, Python and Node passed; Perl support is present
but skips when `perl` is not on PATH.

### Compiled/CLI Bridge

C++, Rust, Go, and many existing tools usually plug in first as compiled executables:

```text
Nx -> bridgeExec("my_tool.exe") -> argv/stdout -> Nx string
```

That is intentionally weaker than the rich bridge:

- stdout is the result
- structured values need JSON discipline from the executable
- Nx can still fence, budget, and audit the call boundary

The stronger future version is a stable Nx FFI/wire protocol so compiled languages can expose
structured functions instead of only command-line stdout.

## 5. MCP And JAMES Are Hosts, Not The Language

MCP tools are another capability catalog. `mcp-bridge.js` turns each MCP tool into a fenced Nx
capability. `nx-run.js` and `nx-live.js` are production runners for agent-written scripts.

JAMES uses this by exposing a narrow `james_nx_run` surface. That is one host integration. Nx
must still work without JAMES:

```text
node nx.js examples/fib.nx
node nx.js
node nx.js fmt examples/fib.nx --check
npm test
```

## 6. Security Boundary

The fence controls which verb a script may call, how often or how much it may spend, and what
gets logged at the Nx boundary.

The fence does **not** sandbox the code inside a granted arbitrary runtime.

If you grant:

- `pyeval`, the script has Python eval power.
- `jseval`, the script has Node eval power.
- `sh`, the script has shell power.
- a C++ executable, the script can run that executable.

Budgets are argument and call-count policies. They are not CPU, filesystem, network, or
subprocess sandboxes for whatever happens inside the granted runtime.

For untrusted or model-generated scripts, expose shaped capabilities instead:

```text
good:  score_lead(id)
bad:   pyeval(any_code)
good:  resize_image(input, output)
bad:   sh(any_command)
```

That is where Nx is strongest: it gives agents narrow verbs, budgets, time/fuel limits, and an
audit trail.

## 7. The Short Version

Nx should become "another Python/C++" in independence, not in purpose.

It should own:

- `.nx` files
- syntax and semantics
- runtime behavior
- standard library
- CLI and REPL
- tests and formatter
- docs and spec
- release path

It should connect:

- Python for Python work
- C++/Rust/Go binaries for compiled work
- Node for JS work
- MCP/JAMES/tools for system work

The point is one independent language that can coordinate many runtimes under one law:

```text
declare what you need
stay inside the budget
leave an audit trail
route to the best provider
run standalone when no foreign runtime is needed
```
