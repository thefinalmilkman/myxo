Write an Myxo script (not just an agent) that the host runs with `requireManifest` on. The host grants two natives, `readFile` and `writeFile` (both return strings). Your script must declare a manifest that permits **only** `readFile` — so even though the host granted `writeFile`, the fence must refuse it (the manifest is the ceiling, not the host's grant).

The script must:

1. Declare a manifest permitting only reads: `needs readFile`.
2. Call `readFile("notes.txt")` and emit `"read: " + <result>`.
3. Attempt `writeFile("notes.txt", "hacked")` inside `attempt/rescue`; because `writeFile` is not declared, the fence refuses it — on refusal emit `"write blocked"`.
4. Call `readFile("notes.txt")` again and emit `"read again: " + <result>`.
