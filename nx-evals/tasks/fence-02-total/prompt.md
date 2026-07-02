Write an Nx script (not just an agent) that the host runs with `requireManifest` on. The host grants two natives: `charge` (returns a string) and `spend` (returns a string), and meters `spend` **by value** (its numeric first argument is the amount spent).

The script must:

1. Declare a manifest permitting `charge` and `spend` with a per-call cap of 5 and a cumulative total of 12: `needs charge, spend(max 5, total 12)`.
2. Call `charge("open")` and emit `"start: " + <result>`.
3. Spend 5 (allowed), emit `"spend ok: " + <result>`.
4. Spend 4 (allowed — cumulative 9), emit `"spend ok: " + <result>`.
5. Attempt to spend 4 more inside `attempt/rescue`; this pushes the cumulative total to 13, over the budget of 12, so on refusal emit `"budget blocked"`.
6. Attempt to spend 9 (over the per-call cap of 5) inside `attempt/rescue`; on refusal emit `"over-cap blocked"`.
