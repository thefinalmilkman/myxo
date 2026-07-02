'use strict';
// docs.test.js — the from-scratch Markdown→HTML renderer behind the docs site.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { mdToHtml, build } = require('../docs/build');
const h = (s) => mdToHtml(s).html;

test('HTML in source text is escaped — no injection', () => {
  assert.match(h('a <script>alert(1)</script> b'), /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(h('<img onerror=x>'), /<img/);
});

test('code fences are verbatim + escaped, with no inner markdown', () => {
  assert.match(h('```\nif x < 3 && y > 1\n```'), /<pre><code>if x &lt; 3 &amp;&amp; y &gt; 1<\/code><\/pre>/);
  assert.match(h('```\n**not bold**\n```'), /\*\*not bold\*\*/);   // not <strong>
});

test('inline: code/bold/italic/link, and no placeholder collision with bare digits', () => {
  assert.equal(h('**b** and *i*'), '<p><strong>b</strong> and <em>i</em></p>');
  assert.match(h('`x`'), /<code>x<\/code>/);
  assert.match(h('[t](http://a&b)'), /<a href="http:\/\/a&amp;b">t<\/a>/);
  assert.equal(h('see `foo` at version 1 now'), '<p>see <code>foo</code> at version 1 now</p>');   // the sentinel-collision bug
});

test('link URLs are scheme-allowlisted, robust to tab/newline/control obfuscation', () => {
  const blocked = (u) => assert.match(h(`[x](${u})`), /href="#"/);
  blocked('javascript:alert(1)');
  blocked('DATA:text/html,evil');
  blocked('java\tscript:throw onerror=alert,1');   // tab inside the scheme (browsers strip it)
  blocked('java\nscript:x');                        // newline
  blocked('java\rscript:x');                        // CR
  blocked('\x01javascript:x');                      // leading C0 control
  // allowed schemes / relative / anchor pass through unchanged
  assert.match(h('[x](https://ok.example)'), /href="https:\/\/ok\.example"/);
  assert.match(h('[x](page.html)'), /href="page.html"/);
  assert.match(h('[x](#sec)'), /href="#sec"/);
  assert.match(h('[x](mailto:a@b)'), /href="mailto:a@b"/);
});

test('a javascript: link is neutralized in EVERY block, not just paragraphs', () => {
  for (const md of ['# [x](javascript:x)', '- [x](javascript:x)', '> [x](javascript:x)', '| [x](javascript:x) |\n|---|\n| y |']) {
    assert.match(h(md), /href="#"/);
    assert.doesNotMatch(h(md), /href="javascript/);
  }
});

test('a quote in a URL cannot break out of the href attribute', () => {
  const out = h('[x](http://a" onmouseover=evil)');
  assert.match(out, /&quot;/);                       // the quote is escaped
  assert.doesNotMatch(out, /"\s+onmouseover/);       // no attribute breakout
});

test('headings get ids; only h1-h3 are collected for the nav', () => {
  assert.match(h('## The Fence!'), /<h2 id="the-fence">/);
  assert.deepEqual(mdToHtml('# A\n## B\n#### D').headings.map((x) => x.id), ['a', 'b']);
});

test('tables, lists, blockquote, hr render', () => {
  assert.match(h('| a | b |\n|---|---|\n| 1 | 2 |'), /<table>.*<th>a<\/th>.*<td>1<\/td>.*<\/table>/s);
  assert.match(h('- one\n- two'), /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(h('1. a\n2. b'), /<ol><li>a<\/li><li>b<\/li><\/ol>/);
  assert.match(h('> quoted'), /<blockquote>quoted<\/blockquote>/);
  assert.match(h('---'), /<hr>/);
});

test('an unclosed code fence consumes to EOF without throwing', () => {
  assert.doesNotThrow(() => h('```\nunclosed'));
  assert.match(h('```\nunclosed'), /<pre><code>unclosed<\/code><\/pre>/);
});

test('build() generates the three pages with the HTML shell + nav', () => {
  build();
  for (const f of ['index.html', 'spec.html', 'readme.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', 'docs', f), 'utf8');
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /<nav>/);
    assert.match(html, /<\/html>$/);
  }
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'docs', 'index.html'), 'utf8'), /capability fence/);
});
