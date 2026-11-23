import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('AC-7: landing and acceptance AC-2 order lists include founders between about and gallery', async () => {
  for (const f of ['tests/landing.spec.js', 'tests/acceptance.spec.js']) {
    const s = read(f);
    const a = s.indexOf("'section#about");
    const fo = s.indexOf("'section#founders");
    const g = s.indexOf("'section#gallery");
    expect(a, f).toBeGreaterThan(-1);
    expect(fo, f).toBeGreaterThan(a);
    expect(g, f).toBeGreaterThan(fo);
  }
});

test('AC-8: README lists Founders after About', async () => {
  const r = read('README.md');
  const a = r.search(/\*\*About/i);
  const f = r.search(/\*\*Founders/i);
  expect(a).toBeGreaterThan(-1);
  expect(f).toBeGreaterThan(a);
});
