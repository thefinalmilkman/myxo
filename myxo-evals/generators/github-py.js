'use strict';
// FREE frontier-tier PYTHON CONTROL generator via GitHub Models. Same rail + same model as github.js
// so the Myxo-vs-Python delta is one-model. No spec sent — Python is assumed known (the asymmetry is
// the whole point: Myxo must be learnable from a small spec; Python the model already has).
const https = require('https');
const { execSync } = require('child_process');
const { extractCode } = require('./extract-py');

const MODEL = process.env.NX_EVAL_GITHUB_MODEL || 'openai/gpt-4o';
const MAX_TOKENS = 4096;
exports.modelId = 'github/' + MODEL;

let cachedToken = null;
function token() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  if (cachedToken) return cachedToken;
  try {
    const t = String(execSync('gh auth token', { stdio: ['ignore', 'pipe', 'ignore'] })).trim();
    if (t) { cachedToken = t; return t; }
  } catch { /* fall through */ }
  return null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function post(body, key) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { host: 'models.github.ai', path: '/inference/chat/completions', method: 'POST',
        headers: { 'authorization': 'Bearer ' + key, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
        timeout: 120000 },
      res => {
        let data = ''; res.on('data', c => (data += c));
        res.on('end', () => {
          let parsed; try { parsed = JSON.parse(data); } catch (e) { return reject(new Error('github parse: ' + e.message)); }
          resolve({ status: res.statusCode, retryAfter: Number(res.headers['retry-after']) || 0, parsed });
        });
      }
    );
    req.on('timeout', () => { req.destroy(new Error('github timeout (120s)')); });
    req.on('error', e => reject(new Error('github unreachable: ' + e.message)));
    req.write(body); req.end();
  });
}

exports.generate = async function (task) {
  const key = token();
  if (!key) throw new Error('no GITHUB_TOKEN / GH_TOKEN and `gh auth token` failed');
  const body = JSON.stringify({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    temperature: 0,
    messages: [
      { role: 'system', content: 'You write ONLY Python code — no prose, no explanation. Standard library only. Return ONE ```python code block containing only the solution (define exactly the function(s) the task names).' },
      { role: 'user', content: '=== TASK ===\n' + task.prompt + '\n\nReturn ONE ```python code block with only the solution.' },
    ],
  });

  let lastErr = 'unknown';
  for (let attempt = 1; attempt <= 4; attempt++) {
    let r;
    try { r = await post(body, key); } catch (e) { lastErr = e.message; }
    if (r) {
      if (r.status === 200) {
        const text = String((r.parsed.choices && r.parsed.choices[0] && r.parsed.choices[0].message && r.parsed.choices[0].message.content) || '');
        if (!text.trim()) throw new Error('github returned no text');
        return extractCode(text);
      }
      const msg = (r.parsed.error && (r.parsed.error.message || r.parsed.error.code)) || r.parsed.message || ('HTTP ' + r.status);
      lastErr = String(msg).slice(0, 160);
      if (r.status === 401 || r.status === 403) throw new Error('github api: ' + lastErr);
      if (r.status !== 429 && r.status < 500) throw new Error('github api: ' + lastErr);
    }
    if (attempt < 4) await sleep(Math.min(60000, (r && r.retryAfter ? r.retryAfter * 1000 : 0) || attempt * 15000));
  }
  throw new Error('github api (after retries): ' + lastErr);
};
