Write an Nx script (not just an agent) that the host runs with `requireManifest` on. The host grants two natives: `lookup` (returns a string) and `notify` (returns a string). Neither is value-metered, so a `total` in the manifest caps the **number of calls**.

The script must:

1. Declare a manifest permitting `lookup` and capping `notify` at 2 calls total: `needs lookup, notify(total 2)`.
2. Call `lookup("acme")` and emit `"found: " + <result>`.
3. Call `notify("first")` (allowed), emit `"notify ok: " + <result>`.
4. Call `notify("second")` (allowed — that is the 2nd and last permitted call), emit `"notify ok: " + <result>`.
5. Attempt a third `notify("third")` inside `attempt/rescue`; it exceeds the call budget, so on refusal emit `"quota blocked"`.
