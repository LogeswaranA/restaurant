import { test, expect } from '@playwright/test';

test('home page has the brand heading and four nav links', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toHaveText('Saffron & Sage');
  await expect(page.locator('.site-nav__link')).toHaveCount(4);
});

test.describe('mobile menu (375px)', () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test('toggle opens and closes the menu', async ({ page }) => {
    await page.goto('/');
    const toggle = page.locator('.nav-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('brand click closes the menu', async ({ page }) => {
    await page.goto('/');
    const toggle = page.locator('.nav-toggle');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await page.locator('.brand').click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('Escape closes the menu', async ({ page }) => {
    await page.goto('/');
    const toggle = page.locator('.nav-toggle');
    await toggle.click();
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
  });
});

test('clicking Gallery marks it as current after scrolling', async ({ page }) => {
  await page.goto('/');
  const link = page.locator('.site-nav__link', { hasText: 'Gallery' });
  await link.click();
  await expect(link).toHaveAttribute('aria-current', 'true');
  await expect.poll(() => page.evaluate(() => Math.round(document.getElementById('gallery').getBoundingClientRect().top))).toBeLessThan(200);
  await expect(link).toHaveAttribute('aria-current', 'true');
});

test('footer year is the current year', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-year]')).toHaveText(String(new Date().getFullYear()));
});

test('gallery images load from the same origin', async ({ page }) => {
  await page.goto('/');
  const images = page.locator('.gallery__grid img');
  const count = await images.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const img = images.nth(i);
    await img.scrollIntoViewIfNeeded();
    await expect.poll(() => img.evaluate((el) => el.complete && el.naturalWidth > 0)).toBe(true);
    const src = await img.evaluate((el) => new URL(el.currentSrc).origin);
    expect(src).toBe('http://localhost:4173');
  }
});
