'use strict';
// Frontier tier via the Anthropic Messages API — zero deps, plain https (matches myxo's no-dep law).
// Shape mirrors ollama.js: exports.generate(task, { specPath }) -> Promise<myxoSourceString>.
//
// Wired per the claude-api skill (2026-07-01):
//   POST https://api.anthropic.com/v1/messages
//   headers: x-api-key, anthropic-version: 2023-06-01, content-type: application/json
//   model default: claude-opus-4-8 (override via NX_EVAL_CLAUDE_MODEL)
//   NOTE: temperature/top_p/top_k are REMOVED on Opus 4.7/4.8 — sending them is a 400.
//   Costs money — opt-in only (run-evals.js --model claude).
const fs = require('fs');
const path = require('path');
const https = require('https');
const { extractNx } = require('./extract');   // shared, multi-block-safe (gate-hardened)

const MODEL = process.env.NX_EVAL_CLAUDE_MODEL || 'claude-opus-4-8';
const MAX_TOKENS = 4096; // Myxo solutions are short; non-streaming is safe at this size
exports.modelId = 'claude/' + MODEL;           // concrete model id for result provenance

// The key lives in the environment, or falls back to JAMES's .env (its home on this machine).
function apiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const jamesEnv = process.env.NX_EVAL_ENV_FILE ||
    path.join(require('os').homedir(), 'Documents', 'Codex', '2026-04-20-do-you-know-jarvis', '.env');
  try {
    const m = fs.readFileSync(jamesEnv, 'utf8').match(/^ANTHROPIC_API_KEY\s*=\s*(.+)\s*$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  } catch { /* fall through */ }
  return null;
}

exports.generate = function (task, opts) {
  return new Promise((resolve, reject) => {
    const key = apiKey();
    if (!key) return reject(new Error('no ANTHROPIC_API_KEY (env or JAMES .env) — use --model ollama for the free tier'));
    let spec;
    try { spec = fs.readFileSync(opts.specPath, 'utf8'); } catch (e) { return reject(new Error('spec unreadable: ' + e.message)); }

    const body = JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: 'You write ONLY Myxo code — no prose, no explanation. Myxo is a language you have never seen; it is defined ENTIRELY by the spec the user provides. Do not assume Python/JS semantics. Return ONE ```myx code block containing only the Myxo solution (define exactly the agents the task names).',
      messages: [{
        role: 'user',
        content: 'Myxo language spec:\n\n' + spec + '\n\n=== TASK ===\n' + task.prompt +
          '\n\nReturn ONE ```myx code block with only the solution.',
      }],
    });

    const req = https.request(
      {
        host: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
        timeout: 120000,
      },
      res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(data); } catch (e) { return reject(new Error('claude parse: ' + e.message + ' — ' + String(data).slice(0, 120))); }
          if (res.statusCode !== 200) {
            const msg = (parsed.error && parsed.error.message) || ('HTTP ' + res.statusCode);
            return reject(new Error('claude api: ' + String(msg).slice(0, 160)));
          }
          if (parsed.stop_reason === 'refusal') return reject(new Error('claude refused (stop_reason: refusal)'));
          const text = (parsed.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
          if (!text.trim()) return reject(new Error('claude returned no text (stop_reason: ' + parsed.stop_reason + ')'));
          resolve(extractNx(text));
        });
      }
    );
    req.on('timeout', () => { req.destroy(new Error('claude timeout (120s)')); });
    req.on('error', e => reject(new Error('claude unreachable: ' + e.message)));
    req.write(body);
    req.end();
  });
};
