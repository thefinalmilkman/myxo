# Nx Independence Contract

Nx must be a real language, not only a wrapper around other languages.

The target is this:

- **Standalone first.** A `.nx` program runs as Nx source through the Nx CLI/runtime/stdlib without requiring Python, C++, Node scripts, shell glue, or JAMES.
- **Own semantics.** `seed`, `agent`, `reinforce`, `decay`, `needs`, budgets, audit ledger, pathway strength, and flow routing are Nx language behavior, not comments over another runtime.
- **Own toolchain.** Nx needs a CLI, REPL, formatter, tests, docs, versioning, module rules, errors, and eventually an LSP/debugger and bytecode/native runtime path.
- **Foreign runtimes are FFI.** Python, Node, Perl, shell, MCP, and compiled binaries such as C++/Rust/Go tools are called through explicit fenced capabilities. They extend Nx; they do not define Nx.
- **One outer law at the boundary.** Whether a capability is written in Nx, Python, C++, or anything else, the Nx caller still goes through `needs`, host allowlists, budgets, fuel/timeouts where applicable, and the audit ledger. Nx does not sandbox arbitrary side effects inside a granted runtime; hosts should expose narrow structured verbs for untrusted callers.
- **No hidden dependency on Nexus.** Nexus/JAMES can host Nx, but Nx must remain usable by itself from the command line and embeddable by other hosts.

## What "another Python/C++" means here

Nx should become a peer in the toolchain: a language someone can install, run, learn, test,
package, and ship. It does not need to replace Python for data scripting or C++ for systems
performance. It needs to be independent the way they are independent: it owns a file format,
runtime, standard library, behavior, documentation, and release path.

## Boundary

Polyglot bridging is still core. Nx connects the useful languages, but as a conductor with its
own score, not as a thin alias for any one of them.
