// Shared Markdown renderer: supported syntax, excluded syntax, links option, escaping and speed.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'packages', 'app-ui', 'markdown.js'), 'utf8') + ';globalThis.Markdown=WorkoutMarkdown;', ctx);
const render = ctx.Markdown.render;
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('PASS ' + name); };

test('empty input renders nothing, so the section can be skipped', () => {
  for (const input of ['', '   \n\n', null, undefined]) assert.equal(render(input), '');
});
test('a single line break stays a line break; a blank line starts a paragraph', () => {
  assert.equal(render('Sit tall.\nFeet flat.\n\nBrace.'), '<div class="md"><p>Sit tall.<br>Feet flat.</p><p>Brace.</p></div>');
});
test('headings start below the sheet title; #### and #tag are text', () => {
  assert.equal(render('# Setup\n## Steps\n### Cues ##'), '<div class="md"><h3>Setup</h3><h4>Steps</h4><h5>Cues</h5></div>');
  assert.equal(render('#### Four\n#tag'), '<div class="md"><p>#### Four<br>#tag</p></div>');
});
test('bold, italic and code nest correctly; snake_case and spaced stars stay literal', () => {
  assert.equal(render('**a *b* c** ***both*** `x * y` 2 * 3 snake_case_name'),
    '<div class="md"><p><strong>a <em>b</em> c</strong> <em><strong>both</strong></em> <code>x * y</code> 2 * 3 snake_case_name</p></div>');
  assert.equal(render('**open only and \\*escaped\\*'), '<div class="md"><p>**open only and *escaped*</p></div>');
});
test('lists nest up to 3 levels, keep numbering after a gap, and fold deeper items into their parent', () => {
  assert.equal(render('1. Grip\n2. Lower\n   - pause\n     continue the pause\n3. Press'),
    '<div class="md"><ol><li>Grip</li><li>Lower<ul><li>pause<br>continue the pause</li></ul></li><li>Press</li></ol></div>');
  assert.equal(render('1. one\n\n3. three'), '<div class="md"><ol><li>one</li></ol><ol start="3"><li>three</li></ol></div>');
  assert.equal(render('- a\n  - b\n    - c\n      - d'), '<div class="md"><ul><li>a<ul><li>b<ul><li>c<br>d</li></ul></li></ul></li></ul></div>');
});
test('quotes and dividers render; tables, links, images, code fences and HTML show as typed', () => {
  assert.equal(render('> Keep the *back* flat\n---'), '<div class="md"><blockquote><p>Keep the <em>back</em> flat</p></blockquote><hr></div>');
  const typed = render('| a | b |\n|---|---|\n[link](https://example.com) ![img](x.png)\n```\ncode\n```\n<b onclick="x">hi</b>');
  assert.doesNotMatch(typed, /<(a|img|table|pre|b)\b/);
  assert.match(typed, /\| a \| b \|<br>\|---\|---\|<br>\[link\]\(https:\/\/example\.com\) !\[img\]\(x\.png\)<br>```<br>code<br>```<br>&lt;b onclick=&quot;x&quot;&gt;hi&lt;\/b&gt;/);
});
test('every tag in the output comes from the fixed set', () => {
  const hostile = ['<script>alert(1)</script>', '**<img src=x onerror=alert(1)>**', '`</code><script>`', '> <iframe>', '- "quoted" & \'single\'', '# <svg onload=1>'].join('\n');
  const tags = [...render(hostile).matchAll(/<\/?([a-z0-9]+)/g)].map(m => m[1]);
  assert.deepEqual([...new Set(tags)].filter(t => !['div','p','br','h3','h4','h5','strong','em','code','ul','ol','li','blockquote','hr'].includes(t)), []);
  assert.doesNotMatch(render(hostile), /<(script|img|iframe|svg)\b|<[a-z][^>]*\son\w+=/, 'hostile markup stays escaped text');
});
test('input beyond 10,000 characters is cut, and worst cases render quickly', () => {
  assert.equal(ctx.Markdown.MAX_LENGTH, 10000);
  assert.ok(render('a'.repeat(12000)).length < 10100);
  const start = Date.now();
  for (const input of ['*'.repeat(10000), '**x '.repeat(2500), '_a '.repeat(3333), ' '.repeat(9999) + '#', '- '.repeat(5000),
    ('  '.repeat(40) + '- a\n').repeat(200), '> '.repeat(5000), '`'.repeat(10000)]) render(input);
  assert.ok(Date.now() - start < 200, 'eight worst-case inputs render in under 200 ms');
});
test('links render only with {links:true}, only for web and mail addresses, and never across lines', () => {
  const text = 'See [the guide](https://example.com/a?b=1) or [mail](mailto:coach@example.com).';
  assert.equal(render(text), '<div class="md"><p>See [the guide](https://example.com/a?b=1) or [mail](mailto:coach@example.com).</p></div>');
  assert.equal(render(text, {links:true}), '<div class="md"><p>See <a href="https://example.com/a?b=1" target="_blank" rel="noopener noreferrer">the guide</a> or ' +
    '<a href="mailto:coach@example.com" target="_blank" rel="noopener noreferrer">mail</a>.</p></div>');
  for (const bad of ['[x](javascript:alert(1))', '[x](data:text/html,hi)', '[x](https://a b)', '[x](https://a"onmouseover="1)', '[x\n](https://a)', '[x](//example.com)'])
    assert.doesNotMatch(render(bad, {links:true}), /<a /, bad);
  assert.equal(render('[**bold** [inner](https://b)](https://a)', {links:true}).match(/<a /g).length, 1, 'a link holds no link');
  assert.match(render('- [step](https://example.com)', {links:true}), /<li><a href="https:\/\/example\.com"/);
});
test('bounded searches keep many unclosed brackets and backticks fast', () => {
  const start = Date.now();
  for (const input of ['['.repeat(10000), '[a]('.repeat(2500), 'a`b`'.repeat(2500), '`'.repeat(1) + 'x'.repeat(9999)]) render(input, {links:true});
  assert.ok(Date.now() - start < 200);
});
console.log(passed + ' markdown tests passed');
