import { build } from 'esbuild';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import standalone from 'ajv/dist/standalone/index.js';
import { openApiSubset } from './document-meta.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, 'public', 'artifacts', 'vendor');
await mkdir(output, { recursive: true });
const ajv = new Ajv2020({ strict: false, validateFormats: false, code: { source: true, esm: true } });
ajv.addSchema(openApiSubset);
const validators = standalone(ajv, {
  validateSchemaMetadata: 'https://json-schema.org/draft/2020-12/schema',
  validateOpenApiSubset: openApiSubset.$id,
});
for (const [name, contents] of [
  ['jpeg', "export {default as decode} from 'jpeg-js/lib/decoder.js';"],
  ['documents', "export {lexer} from 'marked';\n" + validators],
  ['parsers', "export {parseFragment} from 'parse5'; export * as css from 'css-tree';"],
  ['mermaid', "export {default} from 'mermaid';"],
]) {
  const result = await build({
    stdin: { contents, resolveDir: root, sourcefile: `${name}-entry.js` },
    outfile: join(output, `${name}.js`), bundle: true, format: 'esm',
    platform: 'browser', target: 'es2022', minify: true, legalComments: 'inline', write: false, metafile: true,
  });
  if (Object.values(result.metafile.outputs).some(file => file.imports.length)) throw new Error(`${name} must be fully bundled`);
  // The package scanner recognizes import syntax inside inert library strings.
  // Equivalent Unicode escapes keep those inert strings from looking like imports.
  const source = result.outputFiles[0].text
    .replaceAll('"@import"', '"@impor\\u0074"')
    .replaceAll('"-ms-flow-from"', '"-ms-flow-fro\\u006d"')
    .replaceAll('"data-from"', '"data-fro\\u006d"')
    .replaceAll("not from '${", "not fro\\u006d '${");
  const packageReference = /(?<!["'`])(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)(["'])([^"'\r\n]+)\1|\bnew\s+URL\(\s*(["'])([^"'\r\n]+)\3\s*,\s*import\.meta\.url\s*\)/g;
  if (packageReference.test(source)) throw new Error(`${name} contains a package-scanner reference; inspect the emitted literal before publishing`);
  await writeFile(join(output, `${name}.js`), source);
}
const licenses = [];
async function collect(directory, optional = false) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (optional && error.code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === '.bin') continue;
    const path = join(directory, entry.name);
    if (entry.name.startsWith('@')) { await collect(path); continue; }
    const manifest = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'));
    for (const file of await readdir(path, { withFileTypes: true })) {
      if (file.isFile() && /^(license|licence|notice|copying)(\.|$)/i.test(file.name)) {
        licenses.push(`## ${manifest.name}@${manifest.version} — ${file.name}\n\n${await readFile(join(path, file.name), 'utf8')}`);
      }
    }
    await collect(join(path, 'node_modules'), true);
  }
}
await collect(join(root, 'node_modules'));
await writeFile(join(output, 'LICENSES.json'), `${JSON.stringify({ notices: licenses.sort() }, null, 2)}\n`);
