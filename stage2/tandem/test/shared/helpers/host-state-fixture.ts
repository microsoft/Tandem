import { readFile as readDiskFile, writeFile as writeDiskFile } from 'node:fs/promises';
import { sep } from 'node:path';
import { HostStateFile, workspaceForHostPath } from '../../../runtime-src/domain/host-state-file.ts';

function document(path: string): HostStateFile | undefined {
  const root = workspaceForHostPath(path);
  if (!root || !['design', 'policy'].some(name => path.includes(`${sep}living-canvas${sep}${name}${sep}`))) return undefined;
  return new HostStateFile(root, path, undefined, { text: path.endsWith('.md') });
}

export async function readFile(path: string, encoding: 'utf8'): Promise<string> {
  const file = document(path);
  if (file) {
    const content = await file.read();
    if (content !== undefined) return content;
  }
  return readDiskFile(path, encoding);
}

export async function writeFile(path: string, content: string, encoding: 'utf8' = 'utf8'): Promise<void> {
  const file = document(path);
  if (file) await file.transact('test-state-fixture', () => ({ content, result: undefined }));
  else await writeDiskFile(path, content, encoding);
}
