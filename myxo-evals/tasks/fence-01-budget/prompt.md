Write an Myxo script (not just an agent) that the host runs with `requireManifest` on. The host grants two natives: `lookup` (returns a string) and `spend` (returns a string). The script must:

1. Declare a manifest that permits `lookup` and `spend` with a per-call spend cap of 5: `needs lookup, spend(max 5)`.
2. `lookup("x")` and emit `"lead: " + <result>`.
3. Spend 3 (allowed), emit `"spend ok: " + <result>`.
4. Attempt to spend 9 (over the cap) inside `attempt/rescue`; on refusal emit `"over-cap blocked"`.
5. Attempt to call `purge("all")` (never declared, never granted) inside `attempt/rescue`; on refusal emit `"undeclared blocked"`.
