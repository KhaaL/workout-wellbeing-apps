/* Shared Markdown subset for notes and instructions in every app, rendered to
   fixed tags. Supported: paragraphs (a single line break stays a line break),
   # to ### headings, **bold**, *italic*, `code`, bulleted and numbered lists
   nested up to 3 levels, > quotes and --- dividers. With {links:true},
   [text](https://…) and mailto: links open in a new tab; otherwise they show as
   typed. Images, tables, code blocks and raw HTML always show as typed. Every
   piece of text is escaped before it is wrapped, and each search is bounded to
   its own line, so the 10,000-character limit renders in milliseconds. */
/* exported WorkoutMarkdown */
const WorkoutMarkdown = (() => {
  const MAX_LENGTH = 10000, MAX_DEPTH = 3, MAX_OPENERS = 200;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const LIST = /^( *)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
  const WORD = /[\p{L}\p{N}]/u, SPACE = /\s/;

  /* Inline: code spans, then * and _ runs matched through a stack of openers,
     in the CommonMark manner but without its finer flanking rules. */
  function inline(text, options){
    const tokens = [];
    let buf = '';
    /* the next position of a character on the same line, built in one backward
       pass per character, so a page of unclosed [ or ` costs no rescans */
    const next = {};
    const find = (ch, from) => {
      if (!next[ch]){
        const a = next[ch] = new Int32Array(text.length + 1).fill(-1);
        for (let k = text.length - 1; k >= 0; k--) a[k] = text[k] === ch ? k : text[k] === '\n' ? -1 : a[k + 1];
      }
      return from <= text.length ? next[ch][from] : -1;
    };
    const flush = () => { if (buf){ tokens.push({ type:'text', text:buf }); buf = ''; } };
    for (let i = 0; i < text.length; i++){
      const c = text[i];
      if (c === '\\' && i + 1 < text.length && '\\`*_#>-+.![]()'.includes(text[i + 1])){ buf += text[++i]; continue; }
      /* a code span is one backtick each side on one line; a ``` fence or any
         longer run stays literal, since code blocks are not supported */
      if (c === '`'){
        let j = i;
        while (text[j] === '`') j++;
        if (j - i > 1){ buf += text.slice(i, j); i = j - 1; continue; }
        const end = i + 1 < text.length ? find('`', i + 1) : -1;
        if (end > i && text[end + 1] !== '`'){
          flush(); tokens.push({ type:'code', text:text.slice(i + 1, end) }); i = end; continue;
        }
      }
      /* [text](url) with an http, https or mailto address, all on one line */
      if (c === '[' && options.links){
        const close = find(']', i + 1);
        if (close > i && text[close + 1] === '('){
          const end = close + 2 < text.length ? find(')', close + 2) : -1, url = end > close ? text.slice(close + 2, end) : '';
          if (end > close && /^(https?:\/\/|mailto:)[^\s()<>"']+$/i.test(url)){
            flush();
            tokens.push({ type:'html', html:'<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + inline(text.slice(i + 1, close), {}) + '</a>' });
            i = end; continue;
          }
        }
      }
      if (c === '*' || c === '_'){
        let j = i;
        while (text[j] === c) j++;
        const prev = i > 0 ? text[i - 1] : ' ', next = j < text.length ? text[j] : ' ';
        let open = !SPACE.test(next), close = !SPACE.test(prev);
        /* snake_case stays literal; only * may emphasise inside a word */
        if (c === '_' && WORD.test(prev) && WORD.test(next)) open = close = false;
        flush();
        tokens.push({ type:'delim', ch:c, count:j - i, open, close, openTags:[], closeTags:[] });
        i = j - 1; continue;
      }
      buf += c;
    }
    flush();
    const stack = [];
    tokens.forEach((t, idx) => {
      if (t.type !== 'delim') return;
      if (t.close){
        while (t.count > 0){
          let k = stack.length - 1;
          while (k >= 0 && (tokens[stack[k]].ch !== t.ch || tokens[stack[k]].count === 0)) k--;
          if (k < 0) break;
          const o = tokens[stack[k]], n = o.count >= 2 && t.count >= 2 ? 2 : 1, tag = n === 2 ? 'strong' : 'em';
          o.count -= n; t.count -= n;
          /* each later match wraps the earlier one, so it opens first and closes last */
          o.openTags.unshift('<' + tag + '>'); t.closeTags.push('</' + tag + '>');
          stack.length = o.count > 0 ? k + 1 : k;
        }
      }
      if (t.open && t.count > 0 && stack.length < MAX_OPENERS) stack.push(idx);
    });
    return tokens.map(t => t.type === 'text' ? esc(t.text).replace(/\n/g, '<br>') :
      t.type === 'code' ? '<code>' + esc(t.text) + '</code>' : t.type === 'html' ? t.html :
      t.closeTags.join('') + t.ch.repeat(t.count) + t.openTags.join('')).join('');
  }

  function heading(line, options){
    let i = 0;
    while (i < 3 && line[i] === ' ') i++;
    let level = 0;
    while (level < 4 && line[i + level] === '#') level++;
    if (level < 1 || level > 3 || !(line[i + level] === ' ' || line[i + level] === '\t')) return null;
    let text = line.slice(i + level).trim(), k = text.length;
    while (k > 0 && text[k - 1] === '#') k--;
    if (k < text.length && (k === 0 || text[k - 1] === ' ' || text[k - 1] === '\t')) text = text.slice(0, k).trim();
    /* the sheet's own title is an h2, so # starts one level below it */
    return '<h' + (level + 2) + '>' + inline(text, options) + '</h' + (level + 2) + '>';
  }
  function isRule(line){
    const t = line.trim();
    if (t.length < 3 || !'-*_'.includes(t[0])) return false;
    let marks = 0;
    for (const ch of t){ if (ch === t[0]) marks++; else if (ch !== ' ' && ch !== '\t') return false; }
    return marks >= 3;
  }
  const isQuote = line => /^ {0,3}>/.test(line);
  const startsBlock = line => !!heading(line, {}) || isRule(line) || isQuote(line) || LIST.test(line);

  /* Items at one indent form a list; a deeper item starts a nested list up to
     MAX_DEPTH, below which it joins its parent item's text. An indented line
     continues the item above it. A blank line ends the list; a numbered list
     that resumes after one keeps its numbering through the start attribute. */
  function list(lines, startIndex, level, options){
    const first = LIST.exec(lines[startIndex]), indent = first[1].length, ordered = /\d/.test(first[2]);
    const items = [];
    let i = startIndex;
    while (i < lines.length){
      const m = LIST.exec(lines[i]);
      if (m && m[1].length === indent && /\d/.test(m[2]) === ordered){ items.push({ lines:[m[3]], children:[] }); i++; continue; }
      if (m && m[1].length > indent && items.length){
        if (level < MAX_DEPTH){ const [html, next] = list(lines, i, level + 1, options); items[items.length - 1].children.push(html); i = next; }
        else { items[items.length - 1].lines.push(m[3]); i++; }
        continue;
      }
      if (!m && items.length && lines[i].trim() && /^\s/.test(lines[i]) && !startsBlock(lines[i])){
        items[items.length - 1].lines.push(lines[i].trim()); i++; continue;
      }
      break;
    }
    const tag = ordered ? 'ol' : 'ul', start = ordered ? parseInt(first[2], 10) : 1;
    return ['<' + tag + (start > 1 ? ' start="' + start + '"' : '') + '>' +
      items.map(it => '<li>' + inline(it.lines.join('\n'), options) + it.children.join('') + '</li>').join('') +
      '</' + tag + '>', i];
  }

  function blocks(lines, depth, options){
    const out = [];
    let i = 0;
    while (i < lines.length){
      const line = lines[i];
      if (!line.trim()){ i++; continue; }
      const h = heading(line, options);
      if (h){ out.push(h); i++; continue; }
      if (isRule(line)){ out.push('<hr>'); i++; continue; }
      if (isQuote(line)){
        const inner = [];
        while (i < lines.length && isQuote(lines[i])){ inner.push(lines[i].replace(/^ {0,3}> ?/, '')); i++; }
        out.push('<blockquote>' + (depth < MAX_DEPTH ? blocks(inner, depth + 1, options)
          : '<p>' + inline(inner.join('\n'), options) + '</p>') + '</blockquote>');
        continue;
      }
      if (LIST.test(line)){ const [html, next] = list(lines, i, 1, options); out.push(html); i = next; continue; }
      const para = [];
      while (i < lines.length && lines[i].trim() && !(para.length && startsBlock(lines[i]))){ para.push(lines[i].trim()); i++; }
      out.push('<p>' + inline(para.join('\n'), options) + '</p>');
    }
    return out.join('');
  }

  /* Returns '' for empty input, so callers can skip the section.
     options.links: render [text](https://…) and mailto: links (notes allow them,
     instructions do not). */
  function render(source, options = {}){
    const text = String(source == null ? '' : source).slice(0, MAX_LENGTH).replace(/\r\n?/g, '\n');
    if (!text.trim()) return '';
    const lines = text.split('\n').map(line => line.replace(/^\t+/, tabs => '    '.repeat(tabs.length)));
    return '<div class="md">' + blocks(lines, 1, { links:!!options.links }) + '</div>';
  }

  /* An editor's Preview switch: the button toggles between the textarea and the
     rendered text in the preview element. setPreview(…, false) returns to
     editing, e.g. when the textarea gets another record's text. */
  function setPreview(button, box, preview, on, options = {}){
    if (on) preview.innerHTML = render(box.value, options) || '<p class="md-empty">Nothing to preview yet.</p>';
    preview.hidden = !on; box.hidden = on;
    button.setAttribute('aria-pressed', String(on)); button.textContent = on ? 'Edit' : 'Preview';
  }
  function togglePreview(button, box, preview, options = {}){
    const on = button.getAttribute('aria-pressed') !== 'true';
    setPreview(button, box, preview, on, options);
    if (!on) box.focus();
  }
  return { render, setPreview, togglePreview, MAX_LENGTH };
})();
