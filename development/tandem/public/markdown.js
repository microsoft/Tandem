import { normalizeNavigationUrl } from './link-navigation.js';

export function renderMarkdownTokens(document, parent, tokens, { links = false } = {}) {
  const make = (tag, text) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const decode = value => value.replace(/&(?:#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]+);/gi, entity => {
    const decoder = make('textarea');
    // Only a single character reference reaches the HTML parser, never authored markup.
    decoder.innerHTML = entity;
    return decoder.value;
  });
  const wide = node => {
    const wrap = make('div');
    wrap.dataset.documentOverflow = '';
    wrap.style.cssText = 'max-width:100%;min-width:0;overflow-x:auto;';
    wrap.append(node);
    return wrap;
  };
  function inline(parent, tokens) {
    for (const token of tokens ?? []) {
      const tags = { strong: 'strong', em: 'em', del: 's', codespan: 'code' };
      if (Object.hasOwn(tags, token.type)) {
        const child = make(tags[token.type]);
        if (token.tokens) inline(child, token.tokens); else child.textContent = token.text;
        parent.append(child);
      } else if (token.type === 'br') parent.append(make('br'));
      else if (token.type === 'link') {
        let href;
        if (links) {
          try { href = normalizeNavigationUrl(decode(token.href)); }
          catch (error) { if (!(error instanceof Error)) throw error; }
        }
        const target = href ? make('a') : parent;
        if (href) {
          target.href = href;
          target.target = '_blank';
          target.rel = 'noreferrer noopener';
          if (token.title) target.title = decode(token.title);
        }
        inline(target, token.tokens);
        if (href) parent.append(target);
      } else if (token.type === 'image') parent.append(make('span', decode(token.text)));
      else if (token.tokens) inline(parent, token.tokens);
      else parent.append(document.createTextNode(token.type === 'html' ? token.raw
        : token.type === 'escape' ? token.text : decode(token.text ?? token.raw ?? '')));
    }
  }
  function blocks(parent, tokens) {
    for (const token of tokens) {
      if (token.type === 'space') continue;
      if (token.type === 'table') {
        const table = make('table'); table.style.cssText = 'border-collapse:collapse;white-space:normal;';
        const head = make('thead'), body = make('tbody');
        function row(cells, tag) {
          const tr = make('tr');
          for (const [index, cell] of cells.entries()) {
            const td = make(tag); td.style.cssText = 'padding:8px;border:1px solid var(--artifact-document-border,var(--border,#888));min-width:120px;vertical-align:top;';
            if (tag === 'th') td.scope = 'col';
            if (token.align[index]) td.style.textAlign = token.align[index];
            inline(td, cell.tokens); tr.append(td);
          }
          return tr;
        }
        head.append(row(token.header, 'th'));
        for (const cells of token.rows) body.append(row(cells, 'td'));
        table.append(head, body); parent.append(wide(table));
      } else if (token.type === 'code') {
        const pre = make('pre'); pre.style.cssText = 'margin:8px 0;white-space:pre;overflow-wrap:normal;';
        pre.append(make('code', token.text)); parent.append(wide(pre));
      } else if (token.type === 'blockquote') {
        const node = make('blockquote'); blocks(node, token.tokens); parent.append(node);
      } else if (token.type === 'list') {
        const node = make(token.ordered ? 'ol' : 'ul');
        if (token.ordered) node.start = token.start;
        for (const item of token.items) {
          const li = make('li');
          if (item.task) {
            const check = make('input');
            check.type = 'checkbox'; check.disabled = true; check.checked = item.checked;
            check.setAttribute('aria-label', item.checked ? 'Completed task' : 'Incomplete task');
            li.append(check);
          }
          blocks(li, item.tokens); node.append(li);
        }
        parent.append(node);
      } else if (token.type === 'hr') parent.append(make('hr'));
      else {
        const node = make(token.type === 'heading' ? `h${token.depth}` : 'p');
        if (token.tokens) inline(node, token.tokens);
        else node.textContent = token.type === 'html' ? token.raw : decode(token.text ?? token.raw ?? '');
        parent.append(node);
      }
    }
  }
  blocks(parent, tokens);
}
