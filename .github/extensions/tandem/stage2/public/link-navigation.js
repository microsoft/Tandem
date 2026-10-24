export function normalizeNavigationUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 8192 || /[\u0000-\u0020\u007f]/u.test(value)) {
    throw new Error('The link must be an absolute HTTP(S) URL without whitespace or control characters.');
  }
  let url;
  try { url = new URL(value); }
  catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw new Error('The link is not a valid absolute HTTP(S) URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Only HTTP(S) links without embedded credentials can be opened.');
  }
  return url.href;
}

const installed = new WeakMap();

/** User gestures cross the provider/Host bridge; iframe popup permissions are irrelevant. */
export function installBrowserLinkNavigation(document, { open, onError, surface = 'canvas' }) {
  if (typeof open !== 'function' || typeof onError !== 'function') throw new TypeError('Link navigation needs an opener and error reporter.');
  if (!['canvas', 'browser'].includes(surface)) throw new TypeError('Unknown link navigation surface.');
  if (installed.has(document)) throw new Error('Link navigation is already installed for this document.');
  const pending = new Map();
  let disposed = false;
  const activate = (event) => {
    if (event.defaultPrevented
      || (event.type === 'click' ? event.button !== 0 : event.button !== 1)) return;
    const link = event.target?.closest?.('a[href]');
    if (!link || link.ownerDocument !== document || link.hasAttribute('download')) return;
    const raw = link.getAttribute('href');
    if (!raw || raw.startsWith('#')) return;
    let url;
    try { url = normalizeNavigationUrl(link.href); }
    catch (error) { event.preventDefault(); if (event.isTrusted) onError(error); return; }
    if (surface === 'browser') {
      if (!event.isTrusted) { event.preventDefault(); return; }
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      return;
    }
    if (event.altKey) return;
    event.preventDefault();
    if (!event.isTrusted) return;
    if (pending.has(url)) return;
    const previousBusy = link.getAttribute('aria-busy');
    link.setAttribute('aria-busy', 'true');
    const focus = !(event.ctrlKey || event.metaKey || event.button === 1);
    const request = Promise.resolve().then(() => open(url, { focus }))
      .catch((error) => { if (!disposed) onError(error); })
      .finally(() => {
        pending.delete(url);
        if (previousBusy === null) link.removeAttribute('aria-busy');
        else link.setAttribute('aria-busy', previousBusy);
      });
    pending.set(url, request);
  };
  document.addEventListener('click', activate);
  document.addEventListener('auxclick', activate);
  const controller = {
    dispose() {
      disposed = true;
      document.removeEventListener('click', activate);
      document.removeEventListener('auxclick', activate);
      installed.delete(document);
    },
  };
  installed.set(document, controller);
  return controller;
}
