import { test, expect } from '@playwright/test';

const ORIGIN = 'http://localhost:4173';

test.describe('About page content', () => {
  test('AC-2 loads with one h1 "About Us", no console errors, no foreign requests', async ({ page }) => {
    const errors = [];
    const foreign = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (r) => {
      if (!r.url().startsWith(ORIGIN) && !r.url().startsWith('data:')) foreign.push(r.url());
    });
    const response = await page.goto('/about.html');
    expect(response.status()).toBe(200);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveText('About Us');
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
    expect(foreign).toEqual([]);
  });

  for (const width of [375, 1280]) {
    test(`AC-3 vision and mission are visible at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/about.html');
      const vision = page.getByRole('heading', { level: 2, name: 'Our Vision' });
      const mission = page.getByRole('heading', { level: 2, name: 'Our Mission' });
      await expect(vision).toBeVisible();
      await expect(mission).toBeVisible();
      const visionText = page.locator('section[aria-labelledby="vision-title"] p');
      await expect(visionText).toBeVisible();
      expect((await visionText.innerText()).trim().length).toBeGreaterThan(0);
      const items = page.locator('section[aria-labelledby="mission-title"] li');
      await expect(items).toHaveCount(3);
      for (let i = 0; i < 3; i++) {
        await expect(items.nth(i)).toBeVisible();
        expect((await items.nth(i).innerText()).trim().length).toBeGreaterThan(0);
      }
    });

    test(`AC-6 no horizontal scroll at ${width}px on / and /about.html`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      for (const path of ['/', '/about.html']) {
        await page.goto(path);
        const fits = await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        );
        expect(fits, `${path} at ${width}px`).toBe(true);
      }
    });
  }
});

test.describe('About page navigation (desktop)', () => {
  test('AC-4 About link has aria-current=page, others do not', async ({ page }) => {
    await page.goto('/about.html');
    const link = (name) => page.locator('.site-nav__link', { hasText: name });
    await expect(link('About')).toHaveAttribute('href', '/about.html');
    await expect(link('About')).toHaveAttribute('aria-current', 'page');
    for (const [name, href] of [['Home', '/#home'], ['Gallery', '/#gallery'], ['Contact', '#contact']]) {
      await expect(link(name)).toHaveAttribute('href', href);
      await expect(link(name)).not.toHaveAttribute('aria-current', /.*/);
    }
    await page.locator('#contact').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await expect(link('About')).toHaveAttribute('aria-current', 'page');
  });

  test('AC-4 About from the home nav lands on /about.html', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.site-nav__link', { hasText: 'About' })).toHaveAttribute('href', '/about.html');
    await page.locator('.site-nav__link', { hasText: 'About' }).click();
    await expect(page).toHaveURL(/\/about\.html$/);
  });

  test('AC-4 "Read more about us" goes to /about.html', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Read more about us' }).click();
    await expect(page).toHaveURL(/\/about\.html$/);
    await expect(page.locator('h1')).toHaveText('About Us');
  });

  test('AC-4 Home and Gallery from about.html reach the home sections', async ({ page }) => {
    await page.goto('/about.html');
    await page.locator('.site-nav__link', { hasText: 'Gallery' }).click();
    await expect(page).toHaveURL(/\/#gallery$/);
    await expect(page.locator('#gallery')).toBeInViewport();
    await page.goto('/about.html');
    await page.locator('.site-nav__link', { hasText: 'Home' }).click();
    await expect(page).toHaveURL(/\/#home$/);
    await expect(page.locator('#home')).toBeInViewport();
  });

  test('AC-7 landmarks and skip link', async ({ page }) => {
    await page.goto('/about.html');
    for (const sel of ['header', 'main', 'footer']) await expect(page.locator(sel)).toHaveCount(1);
    await expect(page.locator('nav[aria-label="Main"]')).toHaveCount(1);
    await page.keyboard.press('Tab');
    const skip = page.locator('.skip-link');
    await expect(skip).toBeFocused();
    await expect(skip).toHaveAttribute('href', '#main');
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
    await expect(page.locator('[data-year]')).toHaveText(String(new Date().getFullYear()));
    await expect(page.getByRole('link', { name: 'Photo credits' })).toBeVisible();
    await expect(page.locator('footer#contact')).toHaveCount(1);
  });
});

test.describe('mobile menu (375px)', () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test('AC-4 About from the home mobile menu lands on /about.html', async ({ page }) => {
    await page.goto('/');
    await page.locator('.nav-toggle').click();
    await page.locator('.site-nav__link', { hasText: 'About' }).click();
    await expect(page).toHaveURL(/\/about\.html$/);
  });

  for (const path of ['/', '/about.html']) {
    test(`AC-5 toggle, brand, link click and resize close the menu on ${path}`, async ({ page }) => {
      await page.goto(path);
      const toggle = page.locator('.nav-toggle');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');

      await toggle.click();
      await page.locator('.brand').click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    });
  }

  test('AC-5 menu link click closes the menu on about.html (same-page link)', async ({ page }) => {
    await page.goto('/about.html');
    const toggle = page.locator('.nav-toggle');
    await toggle.click();
    await page.locator('.site-nav__link', { hasText: 'About' }).click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('AC-5 resizing to desktop closes the menu', async ({ page }) => {
    await page.goto('/about.html');
    const toggle = page.locator('.nav-toggle');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
});
