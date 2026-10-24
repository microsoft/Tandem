function inlineStyle(style, clone, generated = false) {
  for (const property of style) {
    if ((generated && property === 'content') || property.startsWith('animation') || property.startsWith('transition')) continue;
    let value = style.getPropertyValue(property);
    value = value.replace(/url\(["']?([^"')]+)["']?\)/g, (match, address) => {
      const url = new URL(address, location.href);
      if (url.origin === location.origin && url.pathname === location.pathname && url.hash) return `url(${url.hash})`;
      if (address.startsWith('data:')) return match;
      throw new Error('This diagram contains an external image or font that cannot be captured safely.');
    });
    clone.style.setProperty(property, value);
  }
}

export function generatedContentText(content, source) {
  if (content === '' || content === 'none' || content === 'normal') return null;
  let remaining = content.trim();
  let result = '';
  while (remaining) {
    const literal = remaining.startsWith('"')
      ? /^"((?:[^"\\]|\\[\s\S])*)"/.exec(remaining)
      : /^'((?:[^'\\]|\\[\s\S])*)'/.exec(remaining);
    const attribute = /^attr\(\s*([-_a-zA-Z][-\w:.]*)\s*\)/.exec(remaining);
    if (literal) {
      result += literal[1].replace(/\\([0-9a-fA-F]{1,6})(?:\r\n|[ \t\n\r\f])?|\\(\r\n|[\n\r\f])|\\([\s\S])/g,
        (_match, hex, newline, escaped) => {
          if (hex) {
            const code = parseInt(hex, 16);
            return String.fromCodePoint(code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? 0xfffd : code);
          }
          return newline ? '' : escaped;
        });
      remaining = remaining.slice(literal[0].length).trimStart();
    } else if (attribute) {
      result += source.getAttribute(attribute[1]) ?? '';
      remaining = remaining.slice(attribute[0].length).trimStart();
    } else {
      throw new Error('This diagram uses unsupported generated content. The snapshot was not created; your sketch is retained.');
    }
  }
  return result;
}

function materializePseudo(source, clone, pseudo) {
  const style = source.ownerDocument.defaultView.getComputedStyle(source, pseudo);
  if (style.display === 'none') return;
  const text = generatedContentText(style.content, source);
  if (text === null) return;
  if (source.namespaceURI !== 'http://www.w3.org/1999/xhtml') {
    throw new Error('Generated content on this diagram element cannot be captured faithfully. Your sketch is retained.');
  }
  const box = clone.ownerDocument.createElement('span');
  box.setAttribute('data-capture-pseudo', pseudo.slice(2));
  inlineStyle(style, box, true);
  box.textContent = text;
  if (pseudo === '::before') clone.insertBefore(box, clone.firstChild);
  else clone.append(box);
}

function inlineDiagram(source, clone) {
  inlineStyle(source.ownerDocument.defaultView.getComputedStyle(source), clone);
  for (const attribute of [...clone.attributes]) {
    if (attribute.name.startsWith('on')) clone.removeAttribute(attribute.name);
  }
  if (['script', 'iframe', 'video', 'audio', 'canvas'].includes(source.localName)) {
    throw new Error('This diagram includes content that is not supported by the snapshot renderer.');
  }
  if (['img', 'image'].includes(source.localName)) {
    const address = source.getAttribute('src') ?? source.getAttribute('href') ?? source.getAttribute('xlink:href');
    if (address && !address.startsWith('data:') && !address.startsWith('#')) {
      throw new Error('External diagram images cannot be included in a local snapshot.');
    }
  }
  for (let index = 0; index < source.children.length; index++) inlineDiagram(source.children[index], clone.children[index]);
  // Resolve generated boxes against the live source, but add them only to the
  // detached clone after copying children so their indices and styles stay stable.
  materializePseudo(source, clone, '::before');
  materializePseudo(source, clone, '::after');
}

export function cloneDiagramForCapture(element) {
  const clone = element.cloneNode(true);
  inlineDiagram(element, clone);
  // All layout is computed above. Authored selectors must not restyle the crop
  // frame or the materialized pseudo-elements in the serialized document.
  for (const style of clone.querySelectorAll('style')) style.remove();
  return clone;
}

export function drawAnnotationStrokes(context, strokes) {
  context.strokeStyle = '#e45d34';
  context.lineWidth = 3;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const points of strokes) {
    if (!points.length) continue;
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    if (points.length === 1) context.lineTo(points[0].x + .1, points[0].y + .1);
    else for (const point of points.slice(1)) context.lineTo(point.x, point.y);
    context.stroke();
  }
}

export async function captureAnnotatedDiagram(element, viewport, strokes) {
  if (element.closest?.('[data-artifact-document]')) throw new Error('Document artifacts do not support PNG capture.');
  await document.fonts.ready;
  if (!element.isConnected) throw new Error('The diagram changed before capture. Your sketch is retained.');
  const { width, height, x, y } = viewport;
  const bounds = element.getBoundingClientRect();
  const embedded = element.localName === 'iframe';
  const source = embedded ? element.contentDocument?.body : element;
  if (!source) throw new Error('The isolated artifact is not available for capture.');
  await source.ownerDocument.fonts.ready;
  const nativeWidth = embedded ? element.clientWidth : bounds.width;
  const nativeHeight = embedded ? element.clientHeight : bounds.height;
  if (!(nativeWidth > 0 && nativeHeight > 0)) throw new Error('The artifact has no drawable dimensions.');
  const clone = cloneDiagramForCapture(source);
  clone.hidden = false;
  clone.style.cssText += `;position:relative;left:0;top:0;margin:0;width:${nativeWidth}px;height:${nativeHeight}px;`;
  // Serialized computed styles can put logical inset:auto after physical
  // top/left, resetting the crop on reparse. Keep crop positioning on a clean
  // frame; the cloned diagram and viewport-local strokes retain their geometry.
  const frame = document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
  frame.setAttribute('style', `position:absolute;left:${-x}px;top:${-y}px;width:${bounds.width}px;height:${bounds.height}px;`);
  if (embedded) {
    const scaled = document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
    scaled.setAttribute('style', `width:${nativeWidth}px;height:${nativeHeight}px;transform-origin:0 0;transform:scale(${bounds.width / nativeWidth},${bounds.height / nativeHeight});`);
    scaled.append(clone); frame.append(scaled);
  } else frame.append(clone);
  const body = document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
  let background = 'white';
  for (let node = element; node; node = node.parentElement) {
    const color = getComputedStyle(node).backgroundColor;
    if (color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') { background = color; break; }
  }
  body.setAttribute('style', `position:relative;width:${width}px;height:${height}px;overflow:hidden;background:${background};`);
  body.append(frame);
  const markup = new XMLSerializer().serializeToString(body);
  const image = new Image();
  const loaded = new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('The visible diagram could not be rendered as an image. Your sketch is retained.'));
  });
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${markup}</foreignObject></svg>`)}`;
  await loaded;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  drawAnnotationStrokes(context, strokes);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('The diagram image could not be encoded.')), 'image/png');
  });
}
