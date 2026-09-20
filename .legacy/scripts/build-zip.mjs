import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { zipSync } from 'fflate';

const root = resolve(new URL('..', import.meta.url).pathname);
const outDir = join(root, 'dist');
await fs.mkdir(outDir, { recursive: true });

const entries = {};

async function addFile(relPath) {
  const abs = join(root, relPath);
  const data = await fs.readFile(abs);
  entries[relPath] = new Uint8Array(data);
}

async function addDir(relDir) {
  const absDir = join(root, relDir);
  const children = await fs.readdir(absDir, { withFileTypes: true });
  for (const child of children) {
    const childRel = `${relDir}/${child.name}`;
    if (child.isDirectory()) {
      await addDir(childRel);
      continue;
    }
    await addFile(childRel);
  }
}

await addFile('or3.manifest.json');
await addFile('plugin.client.ts');
await addDir('src');

const zipped = zipSync(entries, { level: 9 });
const outFile = join(outDir, 'or3-tasks.zip');
await fs.writeFile(outFile, Buffer.from(zipped));
console.log(`Wrote ${outFile}`);
