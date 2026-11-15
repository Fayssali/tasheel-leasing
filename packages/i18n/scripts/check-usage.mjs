// Fails when the web app calls t('some.key') with a literal key missing from fr.json.
// Template keys like t(`status.${s}`) are checked by prefix: the prefix object must exist.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const fr = JSON.parse(readFileSync(new URL('../locales/fr.json', import.meta.url), 'utf8'));
const has = (key) =>
  key.split('.').reduce((n, p) => (n && typeof n === 'object' ? n[p] : undefined), fr) !==
  undefined;

const root = new URL('../../../apps/web/src', import.meta.url).pathname;
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|jsx?)$/.test(name)) files.push(p);
  }
})(root);

const missing = [];
let checked = 0;
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) {
    checked++;
    if (!has(m[1])) missing.push(`${m[1]}  (${file.replace(root, 'src')})`);
  }
  for (const m of src.matchAll(/\bt\(\s*`([a-zA-Z0-9_.]+)\.\$\{/g)) {
    checked++;
    if (!has(m[1])) missing.push(`${m[1]}.*  (${file.replace(root, 'src')})`);
  }
}
if (missing.length) {
  console.error(`Missing translation keys:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}
console.log(`i18n usage: ${checked} t() calls in ${files.length} files, all keys exist.`);
