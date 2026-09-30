export function installComposerImage({ input, preview, image, caption, remove, upload, blocked, hasAnnotation, onChange, onError }) {
  let value = null, loading = false;
  function clear() {
    if (value) URL.revokeObjectURL(value.url);
    value = null; preview.hidden = true; image.removeAttribute('src'); onChange();
  }
  remove.addEventListener('click', () => { if (!blocked() && !loading) clear(); });
  input.addEventListener('paste', event => {
    const files = [...(event.clipboardData?.items ?? [])].filter(item => item.kind === 'file').map(item => item.getAsFile()).filter(Boolean);
    if (!files.length) return;
    event.preventDefault();
    if (blocked() || loading) { onError('Wait for the current image or request to finish before pasting.'); return; }
    if (value || hasAnnotation()) { onError('Remove the current image before pasting another. One image is supported per request.'); return; }
    if (files.length !== 1) { onError('Paste one PNG or JPEG image at a time.'); return; }
    const file = files[0], mimeType = file.type.toLowerCase() === 'image/jpg' ? 'image/jpeg' : file.type.toLowerCase();
    if (!['image/png', 'image/jpeg'].includes(mimeType)) { onError('Paste a PNG or JPEG image. Other formats, including SVG, are unsupported.'); return; }
    if (!file.size || file.size > 4 * 1024 * 1024) { onError('Image must be nonempty and at most 4 MiB.'); return; }
    loading = true; preview.hidden = false; caption.textContent = 'Checking image and selected model…'; onError(''); onChange();
    const blob = new Blob([file], { type: mimeType });
    void upload(blob).then(attachment => {
      const url = URL.createObjectURL(blob);
      value = { attachment, blob, url }; image.src = url;
      caption.textContent = `Pasted ${mimeType === 'image/png' ? 'PNG' : 'JPEG'} · ${attachment.width} × ${attachment.height}. Ready to send.`;
    }).catch(error => { preview.hidden = true; onError(error.message); })
      .finally(() => { loading = false; onChange(); });
  });
  return { current: () => value, busy: () => loading, clear,
    refresh() { remove.disabled = loading || blocked(); } };
}
