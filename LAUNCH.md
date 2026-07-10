# Myxo — Launch Checklist

**Where it stands:** the language is verified (379/379 tests, the shipped tarball runs standalone), the
npm package is publish-ready, and the landing page is built. Everything that remains is the outward push —
and the pieces only you can flip are account/key steps, not code.

---

## ✅ Done (this session)
- **Verified the language, not just the tests:** 379/379 pass; packed the tarball, extracted it to a clean
  dir, ran `fib.myx` + `the-law.myx` from the *extracted* copy — both work; CLI reports `1.5.0`.
- **Version reconciled to 1.5** across `README.md`, `why-myxo.html`, and `docs/` (the stale one was a
  hardcoded `# Myxo 1.2` in `docs/build.js` — fixed the generator and rebuilt). Landing was already 1.5.
- **`package.json`** — added `repository`, `homepage`, `bugs`, `engines` (node >=18), `author`, keywords.
- **`.npmignore`** — package trimmed to 57 files / 118 kB (excludes `test/`, `myxo-evals/`, `docs/`, website files).
- **`*.tgz`** gitignored so pack artifacts never get committed.
- **`landing.html`** — living-mesh hero, Python-vs-Myxo panels, capability-fence + audit-ledger section,
  quickstart; SEO/OG/JSON-LD baked into `<head>`, so it's search- and Zero-ready.

## 🔧 Ready when you say go (I can do, no blockers)
- Add an **Myxo feature card** to Zero's homepage (`zero-publish/index.html`) + its `sitemap.xml` + JSON-LD graph.
- Promote `landing.html` → `index.html` at the myxo repo's Pages root (or copy into a `/myxo` publish folder).
- `npm publish --dry-run` as the final pre-flight.
- Draft the launch post (the "a real language, built in the open by an AI" angle) for your review.

## 🔑 Only you can flip (accounts/keys — the actual switches)
1. **GitHub repo** — create public `github.com/thefinalmilkman/myxo` (web UI is fine), **or** rotate the
   dead PAT (it returns 401 per your own notes) so I can push. Confirm the repo name — I assumed `myxo`,
   and the landing + package URLs point there.
2. **GitHub Pages** — enable it on that repo so the landing serves at `thefinalmilkman.github.io/myxo/`
   (the landing's canonical URL and every internal link assume `/myxo/`).
3. **npm** — `npm login` once (your account). Then `npm publish` claims the free `myxo` name.
   (I can run publish once you're logged in, or you run the one command.)

## 🚀 Launch sequence (the order that works)
1. **You:** create the GitHub repo + `npm login`.
2. **Me:** push `myxo` to GitHub `main`, tag `v1.5.0`.
3. **Me:** `npm publish` → `npm i -g myxo` becomes real.
4. **You/Me:** enable Pages → landing goes live at `/myxo/`.
5. **Me:** add the Myxo card to Zero's homepage + sitemap; submit to IndexNow / Search Console.
6. **Verify:** on a clean machine, `npm i -g myxo && myxo` works; landing loads; Zero's links resolve (no 404s).
7. **Me:** publish the announcement post (your review first).

## ⚠️ Honest notes
- The install command and GitHub links on the landing **404 until steps 1–4 are done**. The page ships
  *with* the launch, not before it — a stranger clicking today gets nothing.
- Myxo goes out as its **own repo, featured from Zero** — not a 6th browser tool on the Zero shelf. That keeps
  it consistent with `NEXUS-PLAN.md` ("don't widen Zero until MetaStrip pays"): Zero points at Myxo; Zero's own
  product loop is untouched.
- The GitHub username / repo name / Pages path are **assumptions** (`thefinalmilkman/myxo`, `/myxo/`). Want a
  different name or path? Say so and I'll sweep every URL — landing canonical + links, `package.json`, docs — in one pass.
