export function installComposerEnter(textarea, form, canSend) {
  let composing = false, held = false;
  textarea.addEventListener('compositionstart', () => { composing = true; });
  textarea.addEventListener('compositionend', () => { composing = false; });
  textarea.addEventListener('keyup', (event) => { if (event.key === 'Enter') held = false; });
  textarea.addEventListener('blur', () => { held = false; composing = false; });
  textarea.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || composing || event.keyCode === 229) return;
    event.preventDefault();
    if (event.repeat || held) return;
    held = true;
    if (!textarea.disabled && canSend()) form.requestSubmit();
  });
}
