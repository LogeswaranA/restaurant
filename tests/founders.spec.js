import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

function parseColor(value) {
  const match = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)/);
  if (!match) throw new Error(`Cannot parse colour: ${value}`);
  const [, r, g, b, a] = match;
  return { r: Number(r), g: Number(g), b: Number(b), a: a === undefined ? 1 : Number(a) };
}

function composite(top, bottom) {
  const mix = (t, b) => t * top.a + b * (1 - top.a);
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 };
}

function luminance({ r, g, b }) {
  const channel = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('AC-1: #founders sits between #about and #gallery, labelled by its h2; one h1', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('main > section#founders')).toHaveCount(1);
  const result = await page.evaluate(() => {
    const section = document.querySelector('main > section#founders');
    const heading = document.getElementById(section.getAttribute('aria-labelledby'));
    return {
      labelledby: section.getAttribute('aria-labelledby'),
      afterAbout: section.previousElementSibling === document.querySelector('#about'),
      beforeGallery: section.nextElementSibling === document.querySelector('#gallery'),
      headingOk: !!heading && heading.tagName === 'H2' && heading.textContent.trim().length > 0,
      h1s: document.querySelectorAll('h1').length,
    };
  });
  expect(result).toEqual({
    labelledby: 'founders-title',
    afterAbout: true,
    beforeGallery: true,
    headingOk: true,
    h1s: 1,
  });
});

test('AC-2: eyebrow, quote paragraph and attribution are present', async ({ page }) => {
  await page.goto('/');
  const text = async (sel) => ((await page.locator(sel).first().textContent()) ?? '').trim();
  expect((await text('#founders .eyebrow')).length).toBeGreaterThan(0);
  expect(await page.locator('#founders blockquote p').count()).toBeGreaterThanOrEqual(1);
  expect((await text('#founders blockquote p')).length).toBeGreaterThan(10);
  expect((await text('#founders figcaption')).length).toBeGreaterThan(3);
});

test('AC-3: no interactive controls in #founders and the nav has no founders link', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#founders a, #founders button, #founders input, #founders textarea, #founders select, #founders form')).toHaveCount(0);
  await expect(page.locator('header nav a[href*="founders"]')).toHaveCount(0);
  const hrefs = await page.locator('header nav .site-nav__link').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  expect(hrefs).toEqual(['#home', '#about', '#gallery', '#contact', '/booking.html']);
});

for (const width of [375, 1280]) {
  test(`AC-4: no horizontal overflow and content visible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    const fits = await page.evaluate(() => {
      const s = document.querySelector('#founders');
      return (
        s.scrollWidth <= s.clientWidth && document.documentElement.scrollWidth <= document.documentElement.clientWidth
      );
    });
    expect(fits).toBe(true);
    await expect(page.locator('#founders .section__title')).toBeVisible();
    await expect(page.locator('#founders blockquote')).toBeVisible();
    await expect(page.locator('#founders figcaption')).toBeVisible();
  });
}

test('AC-5: founders text has at least 4.5:1 contrast on its background', async ({ page }) => {
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    const samples = await page.evaluate(() => {
      const layers = (el) => {
        const out = [];
        for (let n = el; n; n = n.parentElement) out.push(getComputedStyle(n).backgroundColor);
        return out;
      };
      return ['#founders .eyebrow', '#founders .section__title', '#founders .founders__quote p', '#founders .founders__author'].map(
        (sel) => {
          const el = document.querySelector(sel);
          return { sel, color: getComputedStyle(el).color, layers: layers(el) };
        },
      );
    });
    for (const { sel, color, layers } of samples) {
      let bg = { r: 255, g: 255, b: 255, a: 1 };
      for (const layer of [...layers].reverse()) bg = composite(parseColor(layer), bg);
      const ratio = contrastRatio(composite(parseColor(color), bg), bg);
      expect(ratio, `${sel} at ${width}px`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test('AC-6: text only (no images) and placeholder comment present', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#founders img, #founders picture, #founders svg')).toHaveCount(0);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  expect(html).toMatch(/<!--[^>]*Placeholder message[^>]*-->\s*<section id="founders"/);
});

test('README mentions the Founders section', async () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  expect(readme).toMatch(/#founders/);
});
