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

test('AC-1: #feedback sits in main after #gallery and before footer#contact, labelled by its h2', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(() => {
    const section = document.querySelector('main > section#feedback');
    const gallery = document.querySelector('#gallery');
    const footer = document.querySelector('footer#contact');
    const heading = section && document.getElementById(section.getAttribute('aria-labelledby'));
    return {
      exists: !!section,
      afterGallery: section?.previousElementSibling === gallery,
      isLast: section?.nextElementSibling === null,
      beforeFooter: !!(section.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING),
      headingOk: !!heading && heading.tagName === 'H2' && heading.classList.contains('section__title'),
      h1s: document.querySelectorAll('h1').length,
    };
  });
  expect(result).toEqual({
    exists: true,
    afterGallery: true,
    isLast: true,
    beforeFooter: true,
    headingOk: true,
    h1s: 1,
  });
});

test('AC-2: exactly three testimonial cards with quote and attribution', async ({ page }) => {
  await page.goto('/');
  const cards = page.locator('#feedback .testimonial');
  await expect(cards).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    const card = cards.nth(i);
    expect(((await card.locator('blockquote').textContent()) ?? '').trim().length).toBeGreaterThan(10);
    expect(((await card.locator('figcaption').textContent()) ?? '').trim().length).toBeGreaterThan(3);
  }
});

test('AC-3: no interactive controls in #feedback and the nav has no feedback link', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#feedback form, #feedback input, #feedback textarea, #feedback select, #feedback button')).toHaveCount(0);
  await expect(page.locator('header nav a[href*="feedback"]')).toHaveCount(0);
});

test('AC-4: cards stack at 375px without overflow and sit side by side at 1280px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  const tops = () =>
    page.locator('#feedback .testimonial').evaluateAll((els) =>
      els.map((el) => Math.round(el.getBoundingClientRect().left)),
    );
  expect(new Set(await tops()).size).toBe(1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(overflow).toBe(true);

  await page.setViewportSize({ width: 1280, height: 800 });
  const ys = await page
    .locator('#feedback .testimonial')
    .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top + window.scrollY)));
  expect(new Set(ys).size).toBe(1);
  expect(new Set(await tops()).size).toBe(3);
});

test('AC-5: feedback text has at least 4.5:1 contrast on its background', async ({ page }) => {
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    const samples = await page.evaluate(() => {
      const pick = (sel) => document.querySelector(sel);
      const layers = (el) => {
        const out = [];
        for (let n = el; n; n = n.parentElement) out.push(getComputedStyle(n).backgroundColor);
        return out;
      };
      return ['#feedback .eyebrow', '#feedback .section__title', '#feedback .section__intro', '#feedback .testimonial__quote p', '#feedback .testimonial__author'].map(
        (sel) => ({ sel, color: getComputedStyle(pick(sel)).color, layers: layers(pick(sel)) }),
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

test('AC-6: README mentions the Feedback section', async () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  expect(readme).toMatch(/Feedback/);
  expect(readme).toMatch(/#feedback/);
});
