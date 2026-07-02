'use strict';
// examples.test.js — every shipped example must PARSE and FORMAT. Parsing would have caught the `flow`-as-keyword
// regression; formatting catches a formatter that doesn't know a node type (e.g. give/take/dispatch/gather/spawn).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parse } = require('../parser');
const { formatSource } = require('../format');

const dir = path.join(__dirname, '..', 'examples');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.nx'));

test('there are examples to check', () => { assert.ok(files.length > 0); });

for (const f of files) {
  test(`example parses + formats: ${f}`, () => {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotThrow(() => parse(src), `examples/${f} failed to parse`);
    let out;
    assert.doesNotThrow(() => { out = formatSource(src); }, `examples/${f} failed to format (a node type the formatter doesn't know?)`);
    assert.doesNotThrow(() => parse(out), `examples/${f} formatted output is not re-parseable`);   // fmt must produce valid Nx
  });
}
