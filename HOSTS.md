# Hosting Myxo — the host integration contract

Myxo is designed to be embedded. A host (such as JAMES, an MCP server, or any Node program) grants Myxo a curated set of capabilities, and Myxo enforces a script's declared reach, budgets, and audit trail. This document is the contract a host should follow.

## The host's job vs. Myxo's job

**Myxo guarantees:**
- A script can only call capabilities it declared in `needs`.
- Value/call budgets declared in `needs` are enforced at runtime.
- Every privileged call and refusal is recorded in an audit ledger.
- `weave`, `pyeval`, `jseval`, `sh`, and other broad runtimes can be fenced at the host's option.

**The host guarantees:**
- Only the intended tools are bridged across the allowlist.
- The implementation of each tool validates its own inputs (SQL allowlists, repo/branch allowlists, structured approval templates, etc.).
- The host keeps its receipt-signing key secret.
- The host decides which tools are value-metered vs. call-count-metered via `valueCaps`.

Myxo is a fence around *which verb* a script may call and *how much*. It does not sandbox what a granted tool does internally.

## The three gates

Production runners (`myxo-run.js` and `myxo-live.js`) apply defense in depth:

```text
host allowlist      -> which tools are even bridged
script `needs`      -> which bridged tools this script may call
value budgets       -> per-call max and cumulative total enforced at runtime
```

A call is refused at the first gate it fails. Every gate decision is logged.

## The JAMES surface

JAMES exposes a narrow MCP surface to Myxo through `james_nx_run`. The current bridged tools are intentionally read-heavy and approval-centric:

| Capability | Type | Purpose |
|------------|------|---------|
| `james_db_query` | read | SELECT-style queries against the JAMES database. |
| `james_read_notes` | read | Read notes, scoped by query. |
| `james_approval_request` | approval queue | Queue a human-review action. No execution. |
| `james_approval_list` | read | Inspect the approval queue. |
| `james_git_push_request` | approval queue | One-tap `git_push` path; still requires human approval and passes JAMES's own repo/branch allowlist. |
| `james_action_await` | read | Poll the result of an approved action. |

**Deliberately absent:** direct memory writes, thought-board posts, Telegram sends, PM2 control, secret access, sandbox exec, rollback, and generic outward-action staging. Myxo can ask for human review; it cannot quietly perform those side effects through `james_nx_run`.

## Bridging tools

A host bridges tools by passing a catalog and a call function:

```js
const { runScript } = require('./myxo-run');
const { runLive } = require('./myxo-live');

const tools = [
  { name: 'james_db_query', inputSchema: { properties: { sql: {} }, required: ['sql'] } },
];

// Synchronous path (in-process MCP shim)
runScript(src, {
  client: { tools, call: (name, args) => mcp.invoke(name, args) },
  allow: ['james_db_query'],      // host allowlist
  requireManifest: true,          // require `needs`
  moduleLoader: null,             // fence `weave`
  receiptKey: hostKey(),          // optional: seal the audit ledger
});

// Asynchronous path (real async tools)
runLive(src, {
  tools,
  onCall: async (name, args) => mcp.invoke(name, args),
  allow: ['james_db_query'],
  requireManifest: true,
  moduleLoader: null,
  receiptKey: hostKey(),
});
```

`allow` is the first gate. Tools not in `allow` are invisible to the script, even if the underlying catalog contains them.

## Metering: value vs. count

The host decides whether a capability is metered by value or by call count:

```js
runScript(src, {
  client: { tools, call },
  valueCaps: ['james_spend'],   // first numeric argument is the spend amount
});
```

A script then declares budgets:

```myx
needs james_spend(max 5, total 15)
emit james_spend(4)    # ok
emit james_spend(100)  # refused: per-call max exceeded
```

Capabilities not in `valueCaps` are call-count metered:

```myx
needs james_approval_request(total 3)
james_approval_request({"action": "a"})  # ok
james_approval_request({"action": "b"})  # ok
james_approval_request({"action": "c"})  # ok
james_approval_request({"action": "d"})  # refused: total exceeded
```

## Audit ledger and receipts

Every privileged call produces a ledger entry:

```js
{ cap: 'james_db_query', args: ['SELECT 1'], ok: true, result: '...' }
{ cap: 'james_pm2_action', args: [...], ok: false, error: 'not declared in needs' }
```

When `receiptKey` is provided, `runScript`/`runLive` return a tamper-evident receipt:

```js
{
  ok: true,
  output: '...',
  audit: [...],
  receipt: {
    entries: [...],   // hash-chained ledger
    seal: { count, root, mac }
  }
}
```

The receipt is sealed in the host process (`runLive`) or inside `runScript`. It can be verified later with the same key:

```js
const { verifyChain } = require('./receipt');
const v = verifyChain(receipt.entries, receipt.seal, key);
// v.ok === true  ->  ledger is intact and sealed by the host
```

Use a persistent key (environment variable or a 0600 keyfile) so receipts remain verifiable across restarts. `receipt.hostKey()` implements this fallback.

## Production defaults

`myxo-run.js` and `myxo-live.js` default to safe production behavior:

- `requireManifest: true` — capability calls require a `needs` declaration.
- `moduleLoader: null` — `weave` is fenced unless the host explicitly grants file loading.
- `maxSteps: 200000` — interpreter fuel to catch runaway loops.
- `timeoutMs: 30000` — wall-clock kill switch for live workers.

Hosts should override these only when they have a reason to be more permissive.

## Preflight with `myxo plan`

Before running an agent-written script, a host can call `myxo plan <file>` to preview its reach:

```
$ node myxo.js plan job.myx
Declared capabilities (needs):
  james_db_query
Capabilities referenced in code:
  james_db_query        OK declared
  james_telegram_send   XX NOT declared (line 4) — the fence would deny it
VERDICT: 1 referenced capability(ies) not declared — this script would be REFUSED at runtime ...
```

This is a best-effort lint, not a sound static gate. The runtime fence remains the real boundary.

## Capability versioning and deprecation

Tool names are part of the contract. If a host renames or removes a tool, existing scripts break. Recommended practices:

1. Keep tool names stable.
2. Add new tools under new names; do not repurpose old names for different semantics.
3. If a tool must change, keep the old name as an alias for at least one release cycle.
4. Publish the supported tool catalog as a JSON schema so scripts and gates can validate against it.

## Security checklist for hosts

- [ ] Validate every argument inside the tool handler, not just at the Myxo fence.
- [ ] For database tools, enforce query shape (e.g., read-only, table allowlist).
- [ ] For approval tools, constrain `action`/`details` to structured templates.
- [ ] For git-push tools, validate repo/branch against a fixed host-side allowlist.
- [ ] Keep the receipt key secret and persistent.
- [ ] Run `myxo plan` as a preflight gate.
- [ ] Set conservative `maxSteps`/`timeoutMs` for untrusted scripts.
- [ ] Log or store the audit ledger/receipt from every run, including failed runs.

## See also

- `examples/james-myxo-demo.js` — runnable demo of the JAMES surface without JAMES up.
- `test/james-integration.test.js` — pinned contract tests for the JAMES surface.
- `receipt.js` — receipt chain/seal/verify implementation.
- `HOW_IT_WORKS.md` — Myxo architecture and security boundary.
