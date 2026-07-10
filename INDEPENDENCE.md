# Myxo Independence Contract

Myxo must be a real language, not only a wrapper around other languages.

The target is this:

- **Standalone first.** A `.myx` program runs as Myxo source through the Myxo CLI/runtime/stdlib without requiring Python, C++, Node scripts, shell glue, or JAMES.
- **Own semantics.** `seed`, `agent`, `reinforce`, `decay`, `needs`, budgets, audit ledger, pathway strength, and flow routing are Myxo language behavior, not comments over another runtime.
- **Own toolchain.** Myxo needs a CLI, REPL, formatter, tests, docs, versioning, module rules, errors, and eventually an LSP/debugger and bytecode/native runtime path.
- **Foreign runtimes are FFI.** Python, Node, Perl, shell, MCP, and compiled binaries such as C++/Rust/Go tools are called through explicit fenced capabilities. They extend Myxo; they do not define Myxo.
- **One outer law at the boundary.** Whether a capability is written in Myxo, Python, C++, or anything else, the Myxo caller still goes through `needs`, host allowlists, budgets, fuel/timeouts where applicable, and the audit ledger. Myxo does not sandbox arbitrary side effects inside a granted runtime; hosts should expose narrow structured verbs for untrusted callers.
- **No hidden dependency on Nexus.** Nexus/JAMES can host Myxo, but Myxo must remain usable by itself from the command line and embeddable by other hosts.

## What "another Python/C++" means here

Myxo should become a peer in the toolchain: a language someone can install, run, learn, test,
package, and ship. It does not need to replace Python for data scripting or C++ for systems
performance. It needs to be independent the way they are independent: it owns a file format,
runtime, standard library, behavior, documentation, and release path.

## Boundary

Polyglot bridging is still core. Myxo connects the useful languages, but as a conductor with its
own score, not as a thin alias for any one of them.
