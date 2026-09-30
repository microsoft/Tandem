import { lexer } from './artifacts/vendor/documents.js';
import { renderMarkdownTokens } from './markdown.js';

export function reduceAssistantResponse(response, event) {
  if (event.sequence <= response.sequence) {
    return response;
  }

  if (event.type === 'request.received' || event.type === 'assistant.turn_start') {
    return { sequence: event.sequence, text: '' };
  }
  if (event.type === 'assistant.message_delta' && event.summary) {
    return { sequence: event.sequence, text: response.text + event.summary };
  }
  if (
    (event.type === 'assistant.message' || event.type === 'workflow.response')
    && typeof event.summary === 'string'
    && event.summary.trim()
  ) {
    return { sequence: event.sequence, text: event.summary };
  }
  return response;
}

export function renderAssistantResponse(container, text) {
  const tokens = lexer(text, { gfm: true, breaks: true });
  container.dataset.markdown = '';
  container.replaceChildren();
  renderMarkdownTokens(container.ownerDocument, container, tokens, { links: true });
}

export function renderPlainResponse(container, text) {
  const document = container.ownerDocument;
  const nodes = [];
  let end = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`]+/gu)) {
    const address = match[0].replace(/[.,;!?)\]]+$/u, '');
    nodes.push(document.createTextNode(text.slice(end, match.index)));
    let url;
    try { url = new URL(address); }
    catch (error) { if (!(error instanceof TypeError)) throw error; }
    if (url && !url.username && !url.password) {
      const link = document.createElement('a');
      link.href = url.href;
      link.textContent = address;
      link.target = '_blank';
      link.rel = 'noreferrer noopener';
      nodes.push(link);
    } else {
      nodes.push(document.createTextNode(address));
    }
    nodes.push(document.createTextNode(match[0].slice(address.length)));
    end = match.index + match[0].length;
  }
  nodes.push(document.createTextNode(text.slice(end)));
  container.replaceChildren(...nodes);
}
