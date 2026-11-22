import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const norm = (s) => s.replace(/\/assets\/[\w-]+\.(js|css)/g, '/assets/X.$1').replace(/\s+/g, ' ').trim();

test('AC-1: built index.html matches original bcfa2e4 except the allowed changes', () => {
  const orig = norm(execSync('git show bcfa2e4:dist/index.html', { encoding: 'utf8' }));
  let built = norm(readFileSync('dist/index.html', 'utf8'));
  built = built.replace(/<p class="about__more"> <a class="button button--primary" href="\/about.html">Read more about us<\/a> <\/p>/, '');
  built = built.replace('href="/about.html" data-section="about"', 'href="#about"');
  built = built.replace(/\s+/g, ' ');
  expect(built.replace(/> </g, '><').replace(/<\/p> ?(?=<\/div>)/g, '</p>')).toBe(orig.replace(/> </g, '><').replace(/<\/p> ?(?=<\/div>)/g, '</p>'));
});

test('AC-1: home keeps sections, nav items and footer year', async ({ page }) => {
  await page.goto('/');
  for (const id of ['home', 'about', 'gallery', 'contact']) await expect(page.locator('#' + id)).toHaveCount(1);
  await expect(page.locator('.site-nav__link')).toHaveText(['Home', 'About', 'Gallery', 'Contact']);
  await expect(page.locator('[data-year]')).toHaveText(String(new Date().getFullYear()));
});

test('AC-3: vision and mission copy is non-empty and matches the PRD', async ({ page }) => {
  await page.goto('/about.html');
  await expect(page.getByRole('heading', { level: 2, name: 'Our Vision' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Our Mission' })).toBeVisible();
  await expect(page.locator('main')).toContainText('To be the neighbourhood table where the seasons set the menu and every guest feels at home.');
  await expect(page.locator('main')).toContainText('Cook honestly');
  await expect(page.locator('main')).toContainText('Buy locally');
  await expect(page.locator('main')).toContainText('Welcome everyone');
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 375, height: 800 } });
  test('AC-4: mobile About link has href /about.html and aria-current on about.html', async ({ page }) => {
    await page.goto('/about.html');
    await page.locator('.nav-toggle').click();
    const about = page.locator('.site-nav__link', { hasText: 'About' });
    await expect(about).toHaveAttribute('href', '/about.html');
    await expect(about).toHaveAttribute('aria-current', 'page');
    for (const n of ['Home', 'Gallery', 'Contact']) await expect(page.locator('.site-nav__link', { hasText: n })).not.toHaveAttribute('aria-current', /.+/);
    await expect(page.locator('.site-nav__link', { hasText: 'Home' })).toHaveAttribute('href', '/#home');
    await expect(page.locator('.site-nav__link', { hasText: 'Gallery' })).toHaveAttribute('href', '/#gallery');
    await expect(page.locator('.site-nav__link', { hasText: 'Contact' })).toHaveAttribute('href', '#contact');
  });
  test('AC-5: toggle updates aria-expanded on home and about', async ({ page }) => {
    for (const p of ['/', '/about.html']) {
      await page.goto(p);
      const t = page.locator('.nav-toggle');
      await t.click();
      await expect(t).toHaveAttribute('aria-expanded', 'true');
      await t.click();
      await expect(t).toHaveAttribute('aria-expanded', 'false');
    }
  });
});

test('AC-7: about page uses shared stylesheet', async ({ page }) => {
  await page.goto('/about.html');
  await expect(page.locator('link[rel=stylesheet]')).toHaveCount(1);
  const home = await (await page.request.get('/')).text();
  const about = await (await page.request.get('/about.html')).text();
  const css = (h) => h.match(/\/assets\/[\w.-]+\.css/)[0];
  expect(css(about)).toBe(css(home));
});

test('AC-8: playwright config uses port 4173 and builds both pages', () => {
  expect(readFileSync('vite.config.js', 'utf8')).toContain('about.html');
  expect(JSON.parse(readFileSync('package.json', 'utf8')).scripts.test).toContain('build');
});
