'use strict';
// FREE frontier-tier generator via GitHub Models (https://models.github.ai) — zero deps, plain https
// (matches myxo's no-dep law). Shape mirrors claude.js: exports.generate(task, { specPath }) ->
// Promise<myxoSourceString>. Same one-model rule as the Claude tier: run-control.js uses github-py.js
// on the SAME model, so the Myxo-vs-Python delta stays single-model.
//
// Auth: GITHUB_TOKEN / GH_TOKEN env, else `gh auth token` (the gh CLI is logged in on this machine).
// Any GitHub PAT works — the Models inference endpoint needs no extra scope on a classic token.
//   POST https://models.github.ai/inference/chat/completions  (OpenAI-compatible)
//   model default: openai/gpt-4o (override via NX_EVAL_GITHUB_MODEL — the catalog also carries
//   gpt-4o-mini, openai/gpt-4.1, deepseek, llama, etc.)
// Free tier is rate-limited (per-model RPM/day caps): we retry 429/5xx with backoff. If the DAILY
// cap is hit, the error is reported honestly per task (finish the run on another day or another rail).
const fs = require('fs');
const https = require('https');
const { execSync } = require('child_process');
const { extractNx } = require('./extract');   // shared, multi-block-safe (gate-hardened)

const MODEL = process.env.NX_EVAL_GITHUB_MODEL || 'openai/gpt-4o';
const MAX_TOKENS = 4096; // Myxo solutions are short; non-streaming is safe at this size
exports.modelId = 'github/' + MODEL;         // concrete model id for result provenance

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

// One POST, resolving with { status, parsed }. Never rejects on HTTP errors — the caller classifies.
function post(body, key) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: 'models.github.ai',
        path: '/inference/chat/completions',
        method: 'POST',
        headers: {
          'authorization': 'Bearer ' + key,
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
          try { parsed = JSON.parse(data); } catch (e) { return reject(new Error('github parse: ' + e.message + ' — ' + String(data).slice(0, 120))); }
          resolve({ status: res.statusCode, retryAfter: Number(res.headers['retry-after']) || 0, parsed });
        });
      }
    );
    req.on('timeout', () => { req.destroy(new Error('github timeout (120s)')); });
    req.on('error', e => reject(new Error('github unreachable: ' + e.message)));
    req.write(body);
    req.end();
  });
}

exports.generate = async function (task, opts) {
  const key = token();
  if (!key) throw new Error('no GITHUB_TOKEN / GH_TOKEN and `gh auth token` failed — use --model ollama for the local tier');
  let spec;
  try { spec = fs.readFileSync(opts.specPath, 'utf8'); } catch (e) { throw new Error('spec unreadable: ' + e.message); }

  const body = JSON.stringify({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    temperature: 0,
    messages: [
      { role: 'system', content: 'You write ONLY Myxo code — no prose, no explanation. Myxo is a language you have never seen; it is defined ENTIRELY by the spec the user provides. Do not assume Python/JS semantics. Return ONE ```myx code block containing only the Myxo solution (define exactly the agents the task names).' },
      { role: 'user', content: 'Myxo language spec:\n\n' + spec + '\n\n=== TASK ===\n' + task.prompt + '\n\nReturn ONE ```myx code block with only the solution.' },
    ],
  });

  let lastErr = 'unknown';
  for (let attempt = 1; attempt <= 4; attempt++) {
    let r;
    try { r = await post(body, key); } catch (e) { lastErr = e.message; }
    if (r) {
      if (r.status === 200) {
        const text = String((r.parsed.choices && r.parsed.choices[0] && r.parsed.choices[0].message && r.parsed.choices[0].message.content) || '');
        if (!text.trim()) throw new Error('github returned no text (finish_reason: ' + (r.parsed.choices && r.parsed.choices[0] && r.parsed.choices[0].finish_reason) + ')');
        return extractNx(text);
      }
      const msg = (r.parsed.error && (r.parsed.error.message || r.parsed.error.code)) || r.parsed.message || ('HTTP ' + r.status);
      lastErr = String(msg).slice(0, 160);
      if (r.status === 401 || r.status === 403) throw new Error('github api: ' + lastErr);   // auth won't heal by retrying
      if (r.status !== 429 && r.status < 500) throw new Error('github api: ' + lastErr);     // a 4xx other than 429 is a real error
    }
    if (attempt < 4) await sleep(Math.min(60000, (r && r.retryAfter ? r.retryAfter * 1000 : 0) || attempt * 15000));
  }
  throw new Error('github api (after retries): ' + lastErr);
};
