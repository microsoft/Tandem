const roles = ['designer', 'agent'];

export function installRoleSuggestions(input, list, enabled) {
  let composing = false, dismissed = null, signature = '', matches = [], selected = 0, heldKey = null;
  const key = () => `${input.value}\0${input.selectionStart}\0${input.selectionEnd}`;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-haspopup', 'listbox');
  input.setAttribute('aria-controls', list.id);
  function close() {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }
  function candidate() {
    if (!enabled() || input.disabled || input.readOnly || composing || input.ownerDocument.activeElement !== input
      || input.selectionStart !== input.selectionEnd) return null;
    const token = /^@([a-z]*)(?=\s|$)/.exec(input.value);
    return token && input.selectionStart >= 1 && input.selectionStart <= token[0].length ? token : null;
  }
  function highlight() {
    for (const [index, option] of [...list.children].entries()) option.setAttribute('aria-selected', String(index === selected));
    input.setAttribute('aria-activedescendant', list.children[selected].id);
  }
  function refresh(open = false) {
    const token = candidate(), nextKey = key();
    if (!token || dismissed === nextKey || list.hidden && !open) { close(); return; }
    matches = roles.filter(role => role.startsWith(token[1]));
    if (!matches.length) { close(); return; }
    if (signature !== nextKey || list.children.length !== matches.length) {
      signature = nextKey; selected = 0;
      list.replaceChildren(...matches.map(role => {
        const option = input.ownerDocument.createElement('button');
        option.type = 'button'; option.tabIndex = -1; option.id = `${list.id}-${role}`;
        option.setAttribute('role', 'option'); option.textContent = `@${role}`;
        option.addEventListener('pointerdown', event => event.preventDefault());
        option.addEventListener('click', () => choose(role));
        return option;
      }));
    }
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    highlight();
  }
  function choose(role) {
    const token = candidate();
    if (!token || !matches.includes(role)) { close(); return; }
    const suffix = input.value.slice(token[0].length);
    const replacement = `@${role}${/^\s/.test(suffix) ? '' : ' '}`;
    input.setRangeText(replacement, 0, token[0].length, 'end');
    input.setSelectionRange(replacement.length + (/^\s/.test(suffix) ? 1 : 0), replacement.length + (/^\s/.test(suffix) ? 1 : 0));
    dismissed = key(); close();
    input.dispatchEvent(new input.ownerDocument.defaultView.Event('input', { bubbles: true }));
  }
  input.addEventListener('input', () => refresh(true));
  input.addEventListener('click', () => refresh(true));
  input.addEventListener('select', () => refresh(true));
  input.ownerDocument.addEventListener('selectionchange', () => { if (input.ownerDocument.activeElement === input) refresh(true); });
  input.addEventListener('compositionstart', () => { composing = true; close(); });
  input.addEventListener('compositionend', () => { composing = false; refresh(true); });
  input.addEventListener('blur', () => { heldKey = null; close(); });
  input.addEventListener('keyup', event => { if (event.key === heldKey) heldKey = null; });
  input.addEventListener('keydown', event => {
    if (event.isComposing || composing || event.keyCode === 229) return;
    if (event.key === heldKey) { event.preventDefault(); return; }
    if (list.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismissed = key(); close(); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      selected = (selected + (event.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length;
      highlight();
    } else if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault(); heldKey = event.key; choose(matches[selected]);
    }
  }, true);
  close();
  return { refresh: () => refresh(false) };
}
