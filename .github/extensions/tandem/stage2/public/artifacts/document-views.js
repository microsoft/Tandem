// These views project declared structure only; they never infer rules or resolve references.
export function renderStructuredDocument(document, artifact, data) {
  const make = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const root = make('div', undefined, 'contract-visual');
  const style = make('style', `
    .contract-visual { min-width:0; font:inherit; line-height:1.45; container-type:inline-size; }
    .contract-visual * { box-sizing:border-box; min-width:0; overflow-wrap:anywhere; }
    .contract-visual details { margin:8px 0; padding:8px; border:1px solid var(--artifact-document-border,var(--border,#888)); border-radius:6px; }
    .contract-visual summary { cursor:pointer; font-weight:600; }
    .contract-visual .contract-fields { display:grid; gap:6px; margin-top:8px; }
    .contract-visual .contract-field { border-inline-start:3px solid var(--blue,#2563eb); padding-inline-start:10px; }
    .contract-visual .contract-badge { display:inline-block; margin:3px; padding:2px 5px; border:1px solid var(--artifact-document-border,var(--border,#888)); border-radius:4px; font-size:.85em; font-weight:400; }
    .contract-visual .contract-pair { display:grid; grid-template-columns:minmax(80px,1fr) minmax(0,2fr); gap:8px; padding:5px 0; border-bottom:1px solid var(--artifact-document-border,var(--border,#888)); }
    .contract-visual .contract-exchange { display:grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr) auto minmax(0,1fr); align-items:start; gap:8px; margin:12px 0; }
    .contract-visual .contract-stage { border-top:3px solid var(--blue,#2563eb); padding:8px; background:var(--blue-soft,transparent); }
    .contract-visual .contract-arrow { padding:8px 0; font-weight:bold; }
    .contract-visual button { color:inherit; background:transparent; border:1px solid var(--artifact-document-border,var(--border,#888)); border-radius:4px; padding:5px; font:inherit; text-align:start; }
    .contract-visual :is(button,summary):focus-visible { outline:2px solid var(--blue,#2563eb); outline-offset:2px; }
    .contract-visual h2,.contract-visual h3 { font-size:1.1em; margin:8px 0; }
    @container (max-width:540px) {
      .contract-visual .contract-exchange { grid-template-columns:minmax(0,1fr); }
      .contract-visual .contract-arrow { justify-self:center; transform:rotate(90deg); padding:0; }
    }
  `);
  root.append(style);
  const targets = new Map(), links = [];
  const pointer = (parent, key) => `${parent}/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;
  function reference(value) {
    const button = make('button', `Reference → ${value}`);
    button.type = 'button';
    links.push({ button, value });
    return button;
  }
  function valueView(value, path) {
    if (value === null || typeof value !== 'object') return make('span', String(value));
    const container = make('div', undefined, 'contract-fields');
    for (const [key, child] of Object.entries(value)) {
      const row = make('div', undefined, 'contract-pair');
      row.append(make('strong', Array.isArray(value) ? `${Number(key) + 1}` : key), valueView(child, pointer(path, key)));
      container.append(row);
    }
    return container;
  }
  function schema(value, name, path, required = null, open = false) {
    const node = make('details');
    node.open = open;
    node.dataset.schemaPointer = path;
    targets.set(path, node);
    const summary = make('summary', name);
    const type = typeof value === 'boolean' ? (value ? 'Any value' : 'No value permitted')
      : Array.isArray(value.type) ? value.type.join(' | ') : value.type ?? 'Unspecified type';
    summary.append(make('span', type, 'contract-badge'));
    if (required !== null) summary.append(make('span', required ? 'Required' : 'Optional', 'contract-badge'));
    node.append(summary);
    if (typeof value === 'boolean') return node;
    for (const [key, child] of Object.entries(value)) {
      const childPath = pointer(path, key);
      if (key === 'type') continue;
      if (key === '$ref' || key === '$dynamicRef') {
        node.append(reference(child));
      } else if (['properties', '$defs', 'patternProperties', 'dependentSchemas'].includes(key)) {
        const fields = make('section', undefined, 'contract-fields');
        fields.append(make('h3', { properties: 'Fields', $defs: 'Entities / definitions', patternProperties: 'Pattern fields', dependentSchemas: 'Dependent schemas' }[key]));
        for (const [field, fieldSchema] of Object.entries(child)) {
          const item = schema(fieldSchema, field, pointer(childPath, field), key === 'properties' ? Boolean(value.required?.includes(field)) : null);
          item.classList.add('contract-field'); fields.append(item);
        }
        node.append(fields);
      } else if (['items', 'contains', 'additionalProperties', 'propertyNames', 'not', 'if', 'then', 'else', 'unevaluatedProperties', 'unevaluatedItems'].includes(key)) {
        node.append(schema(child, key, childPath));
      } else if (['allOf', 'anyOf', 'oneOf', 'prefixItems'].includes(key)) {
        const group = make('details'), heading = make('summary', key);
        group.append(heading);
        child.forEach((branch, index) => group.append(schema(branch, `Branch ${index + 1}`, pointer(childPath, index))));
        node.append(group);
      } else {
        const row = make('div', undefined, 'contract-pair');
        row.append(make('strong', key), valueView(child, childPath));
        node.append(row);
      }
    }
    return node;
  }
  if (artifact.format === 'json-schema') {
    root.append(schema(data, data.title ?? artifact.title, '#', null, true));
  } else {
    root.append(make('h2', data.info.title));
    const methods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
    for (const [path, item] of Object.entries(data.paths)) {
      if (item.$ref) root.append(reference(item.$ref));
      for (const method of methods) {
        const operation = item[method];
        if (!operation) continue;
        const route = make('section');
        route.dataset.apiOperation = `${method.toUpperCase()} ${path}`;
        route.append(make('h3', `${method.toUpperCase()} ${path}`));
        const exchange = make('div', undefined, 'contract-exchange');
        const request = make('div', undefined, 'contract-stage');
        request.append(make('strong', 'Request'));
        const parameters = [];
        for (const parameter of [...(item.parameters ?? []), ...(operation.parameters ?? [])]) {
          const overridden = parameter.$ref ? -1 : parameters.findIndex(previous =>
            !previous.$ref && previous.name === parameter.name && previous.in === parameter.in);
          if (overridden < 0) parameters.push(parameter);
          else parameters[overridden] = parameter;
        }
        for (const parameter of parameters) {
          if (parameter.$ref) request.append(reference(parameter.$ref));
          else {
            const field = schema(parameter.schema ?? {}, `${parameter.in}: ${parameter.name}`, '', parameter.required === true);
            if (parameter.description) field.append(make('span', parameter.description));
            request.append(field);
          }
        }
        function content(parent, value) {
          if (value.$ref) parent.append(reference(value.$ref));
          for (const [media, entry] of Object.entries(value.content ?? {})) parent.append(schema(entry.schema ?? {}, media, ''));
        }
        if (operation.requestBody) {
          request.append(make('span', operation.requestBody.required ? 'Body required' : 'Body optional', 'contract-badge'));
          if (operation.requestBody.description) request.append(make('span', operation.requestBody.description));
          content(request, operation.requestBody);
        } else request.append(make('span', 'No request body declared', 'contract-badge'));
        const action = make('div', undefined, 'contract-stage');
        action.append(make('strong', operation.summary ?? operation.operationId ?? method.toUpperCase()));
        if (operation.description) {
          const detail = make('details'); detail.append(make('summary', 'Operation detail'), make('span', operation.description)); action.append(detail);
        }
        const responses = make('div', undefined, 'contract-stage');
        responses.append(make('strong', 'Responses'));
        for (const [status, response] of Object.entries(operation.responses)) {
          const branch = make('details');
          branch.dataset.apiResponse = status;
          branch.append(make('summary', `${status} · ${response.description ?? 'Reference'}`));
          content(branch, response); responses.append(branch);
        }
        exchange.append(request, make('span', '→', 'contract-arrow'), action, make('span', '→', 'contract-arrow'), responses);
        route.append(exchange); root.append(route);
      }
    }
    for (const [name, value] of Object.entries(data.components?.schemas ?? {})) {
      root.append(schema(value, name, pointer('#/components/schemas', name)));
    }
  }
  for (const { button, value } of links) {
    const target = targets.get(value);
    if (!target) {
      button.replaceWith(make('span', `Unresolved reference → ${value}`, 'contract-badge'));
      continue;
    }
    button.addEventListener('click', () => {
      for (let current = target; current && current !== root; current = current.parentElement) {
        if (current.tagName === 'DETAILS') current.open = true;
      }
      target.scrollIntoView({ block: 'nearest' });
      target.querySelector('summary').focus({ preventScroll: true });
    });
  }
  return root;
}
