'use strict';
// Local Ollama generator — FREE, zero-cost baseline (the mid/small tier).
// Set NX_EVAL_OLLAMA_MODEL to pick the model (default qwen2.5-coder:7b). Ollama must be running on :11434.
const fs = require('fs');
const http = require('http');
const { extractNx } = require('./extract');   // shared, multi-block-safe (gate-hardened)

const MODEL = process.env.NX_EVAL_OLLAMA_MODEL || 'qwen2.5-coder:7b';
exports.modelId = 'ollama/' + MODEL;           // concrete model id for result provenance

exports.generate = function (task, opts) {
  return new Promise((resolve, reject) => {
    let spec;
    try { spec = fs.readFileSync(opts.specPath, 'utf8'); } catch (e) { return reject(new Error('spec unreadable: ' + e.message)); }
    const prompt =
      'You write ONLY Myxo code — no prose, no explanation. Myxo is defined ENTIRELY by this spec (do not assume Python/JS semantics). ' +
      'The task is graded in STRICT mode: any type annotation you write is enforced, so omit annotations unless you are certain of the type.\n\n' +
      spec +
      '\n\n=== TASK ===\n' + task.prompt +
      '\n\nReturn ONE ```myx code block containing only the Myxo solution (define exactly the agents the task names).';
    const body = JSON.stringify({ model: MODEL, prompt, stream: false, options: { temperature: 0 } });
    const req = http.request(
      { host: '127.0.0.1', port: 11434, path: '/api/generate', method: 'POST', headers: { 'content-type': 'application/json' } },
      res => { let data = ''; res.on('data', c => (data += c)); res.on('end', () => { try { resolve(extractNx(JSON.parse(data).response || '')); } catch (e) { reject(new Error('ollama parse: ' + e.message)); } }); }
    );
    req.on('error', e => reject(new Error('ollama unreachable on :11434 (' + e.message + ')')));
    req.write(body); req.end();
  });
};
