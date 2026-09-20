import { readFileSync, writeFileSync } from 'node:fs';
import { buildArtifacts } from './profile.config.mjs';
for (const [name, value] of Object.entries(buildArtifacts().files)) {
  if (process.argv.includes('--check')) {
    if (readFileSync(new URL('../'+name, import.meta.url),'utf8') !== value) throw new Error(name+' is out of date');
  } else writeFileSync(new URL('../'+name, import.meta.url), value);
}
