'use strict';
// Shared code-block extraction for model replies. Hardened per the two-agent gate (2026-07-01):
// the old per-generator regex kept only the FIRST fenced block and prepended a non-nx language tag,
// turning correct multi-agent replies into false-FAILs. This:
//   1. prefers ```nx / ```nexus blocks (concatenates ALL of them, in order),
//   2. else concatenates ALL fenced blocks, stripping any leading language-tag token,
//   3. else returns the trimmed raw text (model answered with no fence).
function extractNx(text) {
  const s = String(text);
  const fences = [...s.matchAll(/```([A-Za-z0-9_+-]*)[ \t]*\r?\n([\s\S]*?)```/g)];
  if (fences.length === 0) return s.trim();
  const nxBlocks = fences.filter(m => /^(nx|nexus)$/i.test(m[1]));
  const chosen = nxBlocks.length ? nxBlocks : fences;      // prefer nx-tagged; else take every block
  return chosen.map(m => m[2].replace(/\s+$/, '')).join('\n\n').trim();
}
module.exports = { extractNx };
