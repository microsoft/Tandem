export function createComposerEnterHandlers(submit) {
  let composing = false, held = false;
  return {
    compositionstart: () => { composing = true; },
    compositionend: () => { composing = false; },
    keyup: (event) => { if (event.key === 'Enter') held = false; },
    blur: () => { held = false; composing = false; },
    keydown: (event, textarea) => {
      if (event.defaultPrevented || event.key !== 'Enter' || event.isComposing || composing || event.keyCode === 229
        || textarea.disabled || textarea.readOnly) return;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const { selectionStart, selectionEnd, maxLength, value } = textarea;
        if (maxLength >= 0 && value.length - (selectionEnd - selectionStart) + 1 > maxLength) return;
        textarea.setRangeText('\n', selectionStart, selectionEnd, 'end');
        textarea.dispatchEvent(new textarea.ownerDocument.defaultView.InputEvent('input', {
          bubbles: true, inputType: 'insertLineBreak', data: null,
        }));
        return;
      }
      if (event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (event.repeat || held) return;
      held = true;
      submit(textarea);
    },
  };
}

export function installComposerEnter(textarea, form, canSend) {
  const handlers = createComposerEnterHandlers(() => {
    if (canSend()) form.requestSubmit();
  });
  const listeners = Object.entries(handlers).map(([type, handler]) => {
    const listener = event => handler(event, textarea);
    textarea.addEventListener(type, listener);
    return [type, listener];
  });
  return () => {
    for (const [type, listener] of listeners) textarea.removeEventListener(type, listener);
  };
}
