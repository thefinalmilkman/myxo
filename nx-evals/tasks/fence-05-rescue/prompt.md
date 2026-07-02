Write an Nx script that the host runs with `requireManifest` on. The host grants two natives: `pay` (returns a string) and `log` (returns a string), and meters `pay` **by value** (its numeric first argument is the amount).

Declare a manifest permitting a per-call pay cap of 10 and an unmetered `log`: `needs pay(max 10), log`.

Define an agent `tryPay(amount)` that:
- inside `attempt/rescue`, calls `pay(amount)` and reports `"paid " + amount`;
- on refusal (e.g. over the per-call cap), calls `log("denied:" + amount)` and reports `"refused " + amount`.

Then emit the result of three calls, one per line:

1. `tryPay(8)`  -> `paid 8`
2. `tryPay(25)` -> `refused 25` (over the per-call cap of 10; the rescue logs it)
3. `tryPay(3)`  -> `paid 3`
