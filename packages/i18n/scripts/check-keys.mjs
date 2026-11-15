// Fails CI when a locale is missing a key that French (the reference locale) has, or has extra keys.
import { readFileSync } from 'node:fs';

const load = (l) =>
  JSON.parse(readFileSync(new URL(`../locales/${l}.json`, import.meta.url), 'utf8'));
const flatten = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );

const reference = new Set(flatten(load('fr')));
let failed = false;
for (const locale of ['ar', 'en']) {
  const keys = new Set(flatten(load(locale)));
  const missing = [...reference].filter((k) => !keys.has(k));
  const extra = [...keys].filter((k) => !reference.has(k));
  if (missing.length || extra.length) {
    failed = true;
    console.error(`${locale}: missing [${missing.join(', ')}] extra [${extra.join(', ')}]`);
  }
}
if (failed) process.exit(1);
console.log(`i18n: ${reference.size} keys, all locales complete.`);
