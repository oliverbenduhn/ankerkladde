import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2]);
const output = path.join(root, 'asset-manifest.json');

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (absolute === output) continue;
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else files.push(path.relative(root, absolute).split(path.sep).join('/'));
  }
  return files;
}

const files = (await walk(root)).sort();
await writeFile(output, `${JSON.stringify(files, null, 2)}\n`);
