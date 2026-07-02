'use strict';
// Local Ollama generator for the PYTHON CONTROL group — FREE. Same model as the Nx ollama generator, so the
// Nx-vs-Python delta is measured on ONE model. No spec is sent (Python is assumed known); that asymmetry is
// the point — Nx must be learnable from a small spec, Python the model already knows.
const http = require('http');
const { extractCode } = require('./extract-py');

const MODEL = process.env.NX_EVAL_OLLAMA_MODEL || 'qwen2.5-coder:7b';
exports.modelId = 'ollama/' + MODEL;

exports.generate = function (task) {
  return new Promise((resolve, reject) => {
    const prompt =
      'You write ONLY Python code — no prose, no explanation. Standard library only, no imports unless necessary.\n\n' +
      '=== TASK ===\n' + task.prompt +
      '\n\nReturn ONE ```python code block containing only the solution (define exactly the function(s) the task names).';
    const body = JSON.stringify({ model: MODEL, prompt, stream: false, options: { temperature: 0 } });
    const req = http.request(
      { host: '127.0.0.1', port: 11434, path: '/api/generate', method: 'POST', headers: { 'content-type': 'application/json' } },
      res => { let data = ''; res.on('data', c => (data += c)); res.on('end', () => { try { resolve(extractCode(JSON.parse(data).response || '')); } catch (e) { reject(new Error('ollama parse: ' + e.message)); } }); }
    );
    req.on('error', e => reject(new Error('ollama unreachable on :11434 (' + e.message + ')')));
    req.write(body); req.end();
  });
};
