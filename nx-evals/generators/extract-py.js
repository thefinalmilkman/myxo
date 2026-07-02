'use strict';
// Extract Python code from a model reply (control-group generators). Same multi-block-safe approach as
// extract.js: prefer ```python blocks, else any fenced block (tag stripped), else raw text.
function extractCode(text) {
  const s = String(text);
  const fences = [...s.matchAll(/```([A-Za-z0-9_+-]*)[ \t]*\r?\n([\s\S]*?)```/g)];
  if (fences.length === 0) return s.trim();
  const py = fences.filter(m => /^(py|python|python3)$/i.test(m[1]));
  const chosen = py.length ? py : fences;
  return chosen.map(m => m[2].replace(/\s+$/, '')).join('\n\n').trim();
}
module.exports = { extractCode };
