'use strict';
// Frontier-tier PYTHON CONTROL generator via the Anthropic Messages API (opt-in; costs). Same model as the
// Myxo claude generator so the delta is one-model. No spec sent — Python is assumed known (the asymmetry is
// the whole point: Myxo must be learnable from a small spec; Python the model already has).
const fs = require('fs');
const path = require('path');
const https = require('https');
const { extractCode } = require('./extract-py');

const MODEL = process.env.NX_EVAL_CLAUDE_MODEL || 'claude-opus-4-8';
const MAX_TOKENS = 4096;
exports.modelId = 'claude/' + MODEL;

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

exports.generate = function (task) {
  return new Promise((resolve, reject) => {
    const key = apiKey();
    if (!key) return reject(new Error('no ANTHROPIC_API_KEY (env or JAMES .env)'));
    const body = JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: 'You write ONLY Python code — no prose, no explanation. Standard library only. Return ONE ```python code block containing only the solution (define exactly the function(s) the task names).',
      messages: [{ role: 'user', content: '=== TASK ===\n' + task.prompt + '\n\nReturn ONE ```python code block with only the solution.' }],
    });
    const req = https.request(
      { host: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
        timeout: 120000 },
      res => {
        let data = ''; res.on('data', c => (data += c));
        res.on('end', () => {
          let parsed; try { parsed = JSON.parse(data); } catch (e) { return reject(new Error('claude parse: ' + e.message)); }
          if (res.statusCode !== 200) return reject(new Error('claude api: ' + String((parsed.error && parsed.error.message) || res.statusCode).slice(0, 160)));
          if (parsed.stop_reason === 'refusal') return reject(new Error('claude refused'));
          const text = (parsed.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
          if (!text.trim()) return reject(new Error('claude returned no text'));
          resolve(extractCode(text));
        });
      }
    );
    req.on('timeout', () => { req.destroy(new Error('claude timeout (120s)')); });
    req.on('error', e => reject(new Error('claude unreachable: ' + e.message)));
    req.write(body); req.end();
  });
};
