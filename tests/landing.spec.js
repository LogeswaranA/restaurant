// Smoke tests for the Saffron & Sage landing page (prd.md AC-2 … AC-14).
// They run against the production build served by `vite preview` (see playwright.config.js).
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const VIEWPORTS = {
  mobile: { width: 375, height: 667 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 720 },
};

const NAV_TARGETS = ['#home', '#about', '#gallery', '#contact'];

/** Resolves once the window has stopped scrolling (smooth scroll finished). */
async function waitForScrollEnd(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        let last = window.scrollY;
        let stableFrames = 0;
        const tick = () => {
          if (window.scrollY === last) stableFrames += 1;
          else stableFrames = 0;
          last = window.scrollY;
          if (stableFrames >= 10) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}

function navLink(page, name) {
  return page.locator('header nav').getByRole('link', { name, exact: true });
}

/* ------------------------------------------------------------------ colour helpers */

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

/* ------------------------------------------------------------------ tests */

test.describe('Structure & content', () => {
  test('AC-2: landmarks and sections are in the right order', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('header nav')).toHaveCount(1);
    await expect(page.locator('main')).toHaveCount(1);

    const order = await page.evaluate(() =>
      Array.from(document.querySelectorAll('main > section[id], body > footer[id]')).map(
        (el) => `${el.tagName.toLowerCase()}#${el.id}:${el.closest('main') ? 'main' : 'body'}`,
      ),
    );
    expect(order).toEqual([
      'section#home:main',
      'section#about:main',
      'section#gallery:main',
      'section#feedback:main',
      'footer#contact:body',
    ]);

    // footer comes after main in the document
    const footerFollowsMain = await page.evaluate(
      () =>
        !!(
          document.querySelector('main').compareDocumentPosition(document.querySelector('footer#contact')) &
          Node.DOCUMENT_POSITION_FOLLOWING
        ),
    );
    expect(footerFollowsMain).toBe(true);
  });

  test('AC-3: hero has one h1, the tagline and both CTAs', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveText('Saffron & Sage');
    await expect(page.locator('#home').getByText('Seasonal kitchen, honest flavours')).toBeVisible();

    const viewGallery = page.locator('#home').getByRole('link', { name: 'View Gallery' });
    await expect(viewGallery).toHaveAttribute('href', '#gallery');

    const reserve = page.locator('#home').getByRole('link', { name: 'Reserve a Table' });
    // The hero CTA opens the booking page; phone bookings stay available via the footer tel: link.
    await expect(reserve).toHaveAttribute('href', '/booking.html');
    await expect(page.locator('footer#contact a[href^="tel:"]')).not.toHaveCount(0);
  });

  test('AC-4: headings are nested without skipped levels; about has two paragraphs', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#about h2')).toHaveCount(1);
    await expect(page.locator('#gallery h2')).toHaveCount(1);

    const levels = await page.evaluate(() =>
      Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map((h) => Number(h.tagName[1])),
    );
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i], `heading #${i} (h${levels[i]}) after h${levels[i - 1]}`).toBeLessThanOrEqual(
        levels[i - 1] + 1,
      );
    }

    const paragraphs = await page
      .locator('#about p')
      .evaluateAll((ps) => ps.map((p) => p.textContent.trim()).filter(Boolean));
    expect(paragraphs.length).toBeGreaterThanOrEqual(2);
  });

  test('AC-5: gallery images are local, described, lazy, sized and load', async ({ page, baseURL }) => {
    await page.goto('/');
    const images = page.locator('#gallery img');
    const count = await images.count();
    expect(count).toBeGreaterThanOrEqual(6);

    const alts = [];
    for (let i = 0; i < count; i += 1) {
      const img = images.nth(i);
      const alt = ((await img.getAttribute('alt')) ?? '').trim();
      expect(alt, `img ${i} alt`).not.toBe('');
      expect(alt, `img ${i} alt is generic`).not.toMatch(/^(image|photo|dish)\s*\d*$/i);
      alts.push(alt);

      await expect(img).toHaveAttribute('loading', 'lazy');
      await expect(img).toHaveAttribute('width', /^\d+$/);
      await expect(img).toHaveAttribute('height', /^\d+$/);

      const src = await img.evaluate((el) => el.currentSrc || el.src);
      const url = new URL(src);
      expect(url.origin).toBe(new URL(baseURL).origin);
      expect(url.pathname).toMatch(/^\/images\//);

      // lazy images load once they approach the viewport
      await img.scrollIntoViewIfNeeded();
      await expect.poll(() => img.evaluate((el) => el.complete && el.naturalWidth)).toBeGreaterThan(0);
    }
    expect(new Set(alts).size).toBe(alts.length);
  });

  test('AC-7: footer has address, hours, phone, email, social links and copyright', async ({ page }) => {
    await page.goto('/');
    const footer = page.locator('footer#contact');
    await expect(footer.locator('address')).toContainText(/\w+/);
    await expect(footer).toContainText(/opening hours/i);
    await expect(footer).toContainText(/\d{1,2}:\d{2}/);
    await expect(footer.locator('a[href^="tel:"]')).not.toHaveCount(0);
    await expect(footer.locator('a[href^="mailto:"]')).not.toHaveCount(0);

    const social = footer.locator('.social a');
    expect(await social.count()).toBeGreaterThanOrEqual(2);
    for (const link of await social.all()) {
      const name = ((await link.getAttribute('aria-label')) || (await link.textContent()) || '').trim();
      expect(name).not.toBe('');
    }

    const year = String(new Date().getFullYear());
    await expect(footer.getByText(/©/)).toContainText(year);
  });
});

test.describe('Layout', () => {
  for (const [label, expectation] of [
    ['mobile', (n) => expect(n).toBe(1)],
    ['tablet', (n) => expect(n).toBe(2)],
    ['desktop', (n) => expect(n).toBeGreaterThanOrEqual(3)],
  ]) {
    test(`AC-6: gallery column count at ${VIEWPORTS[label].width}px`, async ({ page }) => {
      await page.setViewportSize(VIEWPORTS[label]);
      await page.goto('/');
      const columns = await page
        .locator('#gallery .gallery__grid > li')
        .evaluateAll((items) => new Set(items.map((el) => Math.round(el.getBoundingClientRect().left))).size);
      expectation(columns);
    });
  }

  for (const [label, size] of Object.entries(VIEWPORTS)) {
    test(`AC-11: no horizontal overflow at ${size.width}px (${label})`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto('/');
      const { scrollWidth, innerWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(innerWidth);

      if (label === 'mobile') {
        // the open mobile menu must not overflow either
        await page.getByRole('button', { name: 'Menu' }).click();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          size.width,
        );
      }
    });
  }
});

test.describe('Navigation', () => {
  test('AC-8: nav links scroll to sections below the sticky header', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.goto('/');

    for (const href of NAV_TARGETS) {
      await expect(page.locator(`header nav a[href="${href}"]`)).toHaveCount(1);
    }

    await navLink(page, 'Gallery').click();
    await expect(page).toHaveURL(/#gallery$/);
    await waitForScrollEnd(page);

    const headerBox = await page.locator('body > header').boundingBox();
    const headingBox = await page.locator('#gallery h2').boundingBox();
    expect(headingBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height);
    expect(headingBox.y + headingBox.height).toBeLessThanOrEqual(VIEWPORTS.desktop.height);

    // sticky header stays pinned at the top when the footer is reached
    await page.locator('footer#contact').scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await waitForScrollEnd(page);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    const stickyBox = await page.locator('body > header').boundingBox();
    expect(stickyBox.y).toBe(0);
    await expect(page.locator('body > header')).toBeInViewport();
  });

  test('AC-9: exactly one nav link marks the current section', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.goto('/');

    const activeHrefs = () =>
      page
        .locator('header nav a')
        .evaluateAll((links) =>
          links
            .filter((a) => a.getAttribute('aria-current') === 'true' || a.classList.contains('active'))
            .map((a) => a.getAttribute('href')),
        );

    await expect.poll(activeHrefs).toEqual(['#home']);

    await navLink(page, 'About').click();
    await waitForScrollEnd(page);
    await expect.poll(activeHrefs).toEqual(['#about']);

    await navLink(page, 'Gallery').click();
    await waitForScrollEnd(page);
    await expect.poll(activeHrefs).toEqual(['#gallery']);

    await navLink(page, 'Contact').click();
    await waitForScrollEnd(page);
    await expect.poll(activeHrefs).toEqual(['#contact']);

    // Scrolling by hand (mouse wheel) back to the top hands control back to the observer.
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, -100000);
    await waitForScrollEnd(page);
    await expect.poll(activeHrefs).toEqual(['#home']);
  });

  test('AC-9: a deep link marks its section as current on load', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.goto('/#about');
    await expect(page.locator('header nav a[aria-current="true"]')).toHaveCount(1);
    await expect(navLink(page, 'About')).toHaveAttribute('aria-current', 'true');
  });

  test('AC-10: mobile menu toggles with aria-expanded and closes after choosing a link', async ({
    page,
  }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto('/');

    const toggle = page.locator('header nav button');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const controls = await toggle.getAttribute('aria-controls');
    expect(controls).toBeTruthy();
    await expect(page.locator(`#${controls}`)).toHaveCount(1);

    for (const name of ['Home', 'About', 'Gallery', 'Contact']) {
      await expect(navLink(page, name)).toBeHidden();
    }

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    for (const name of ['Home', 'About', 'Gallery', 'Contact']) {
      await expect(navLink(page, name)).toBeVisible();
    }

    await navLink(page, 'About').click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(navLink(page, 'About')).toBeHidden();
    await expect(page).toHaveURL(/#about$/);
  });

  test('AC-10: tapping the brand link closes the open mobile menu', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto('/');
    const toggle = page.locator('header nav button');

    // Scroll away first so the brand link has somewhere to take us.
    await page.evaluate(() => window.scrollTo({ top: 600, behavior: 'instant' }));
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(navLink(page, 'About')).toBeVisible();

    await page.locator('header a.brand').click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(navLink(page, 'About')).toBeHidden();
    await expect(page).toHaveURL(/#home$/);
  });

  test('AC-10: the mobile menu closes when the viewport grows to desktop width', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto('/');
    const toggle = page.locator('header nav button');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await page.setViewportSize(VIEWPORTS.desktop);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('AC-9: the current link follows scripted scrolling after a nav click', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.goto('/');
    const activeHrefs = () =>
      page.locator('header nav a[aria-current="true"]').evaluateAll((links) => links.map((a) => a.hash));

    await navLink(page, 'Gallery').click();
    await waitForScrollEnd(page);
    await expect.poll(activeHrefs).toEqual(['#gallery']);

    // No wheel/touch/key involved (like dragging the scrollbar): the link must not go stale.
    await page.evaluate(() => {
      const about = document.querySelector('#about');
      window.scrollTo({ top: about.getBoundingClientRect().top + window.scrollY, behavior: 'instant' });
    });
    await waitForScrollEnd(page);
    await expect.poll(activeHrefs).toEqual(['#about']);

    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await waitForScrollEnd(page);
    await expect.poll(activeHrefs).toEqual(['#home']);
  });

  test('AC-10: Escape closes the mobile menu and returns focus to the toggle', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto('/');
    const toggle = page.locator('header nav button');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
  });

  test('AC-10: desktop shows the links without a toggle', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.goto('/');
    await expect(page.locator('header nav button')).toBeHidden();
    for (const name of ['Home', 'About', 'Gallery', 'Contact']) {
      await expect(navLink(page, name)).toBeVisible();
    }
  });
});

test.describe('Accessibility basics (AC-12)', () => {
  test('tap targets are at least 44×44 px at 375px', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto('/');

    const toggle = page.locator('header nav button');
    const targets = [
      toggle,
      page.locator('#home').getByRole('link', { name: 'View Gallery' }),
      page.locator('#home').getByRole('link', { name: 'Reserve a Table' }),
    ];
    for (const target of targets) {
      const box = await target.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }

    await toggle.click();
    for (const link of await page.locator('header nav a').all()) {
      const box = await link.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });

  test('keyboard focus is visible on links', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.goto('/');

    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Tab');
      const focus = await page.evaluate(() => {
        const el = document.activeElement;
        const style = getComputedStyle(el);
        return {
          tag: el.tagName,
          text: el.textContent.trim(),
          outlineStyle: style.outlineStyle,
          outlineWidth: parseFloat(style.outlineWidth),
          boxShadow: style.boxShadow,
        };
      });
      expect(focus.tag, `tab stop ${i}`).toBe('A');
      const visible = (focus.outlineStyle !== 'none' && focus.outlineWidth > 0) || focus.boxShadow !== 'none';
      expect(visible, `focus style on "${focus.text}"`).toBe(true);
    }
  });

  test('every section eyebrow has at least 4.5:1 contrast against its background', async ({ page }) => {
    await page.goto('/');
    const samples = await page.locator('main .eyebrow').evaluateAll((els) =>
      els.map((el) => {
        // Effective background: the nearest ancestor with a non-transparent background colour.
        let bg = 'rgb(255, 255, 255)';
        for (let node = el; node; node = node.parentElement) {
          const color = getComputedStyle(node).backgroundColor;
          if (!/^rgba\(.*,\s*0\)$|^transparent$/.test(color)) {
            bg = color;
            break;
          }
        }
        return { text: el.textContent.trim(), color: getComputedStyle(el).color, bg };
      }),
    );

    expect(samples.map((s) => s.text)).toEqual(expect.arrayContaining(['Our story', 'From our kitchen']));
    for (const { text, color, bg } of samples) {
      const background = parseColor(bg);
      const ratio = contrastRatio(composite(parseColor(color), background), background);
      expect(ratio, `"${text}" (${color} on ${bg})`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('hero CTAs are equal width when stacked and the credits link stays on one line at 375px', async ({
    page,
  }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto('/');
    const view = await page.locator('#home').getByRole('link', { name: 'View Gallery' }).boundingBox();
    const reserve = await page.locator('#home').getByRole('link', { name: 'Reserve a Table' }).boundingBox();
    expect(reserve.y, 'buttons are stacked at 375px').toBeGreaterThan(view.y);
    expect(Math.abs(view.width - reserve.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(view.x - reserve.x)).toBeLessThanOrEqual(1);

    const credits = page.locator('footer').getByRole('link', { name: 'Photo credits' });
    expect(await credits.evaluate((el) => el.getClientRects().length)).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      VIEWPORTS.mobile.width,
    );
  });

  test('hero text contrast against the overlay is at least 4.5:1', async ({ page }) => {
    await page.goto('/');
    const styles = await page.evaluate(() => {
      const hero = document.querySelector('#home');
      return {
        backgroundImage: getComputedStyle(hero).backgroundImage,
        h1: getComputedStyle(hero.querySelector('h1')).color,
        tagline: getComputedStyle(hero.querySelector('.hero__tagline')).color,
      };
    });

    // The overlay really is painted over the photo (gradient layer first, photo underneath).
    expect(styles.backgroundImage).toMatch(/^linear-gradient\(/);
    expect(styles.backgroundImage).toContain('/images/hero-dining-room.jpg');

    // Read the overlay's colour stops from the computed value: the browser serialises them as
    // rgb()/rgba() even when the minified CSS source uses hex.
    const gradient = styles.backgroundImage.slice(0, styles.backgroundImage.indexOf('url('));
    const stops = (gradient.match(/rgba?\([^)]*\)/g) ?? []).map(parseColor);
    expect(stops.length, 'overlay colour stops').toBeGreaterThanOrEqual(2);

    // Worst case: the lightest stop of the overlay on top of a pure white photo pixel.
    const white = { r: 255, g: 255, b: 255, a: 1 };
    const lightestOverlay = stops
      .map((overlay) => composite(overlay, white))
      .sort((a, b) => luminance(b) - luminance(a))[0];

    for (const [name, color] of [
      ['h1', styles.h1],
      ['tagline', styles.tagline],
    ]) {
      const ratio = contrastRatio(composite(parseColor(color), lightestOverlay), lightestOverlay);
      expect(ratio, `${name} contrast`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

test('AC-13: clean load — no console errors, failed or third-party requests', async ({ page, baseURL }) => {
  const problems = [];
  const origin = new URL(baseURL).origin;
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.protocol !== 'data:' && url.origin !== origin) problems.push(`external request: ${req.url()}`);
  });
  page.on('response', (res) => {
    if (res.status() >= 400) problems.push(`HTTP ${res.status()}: ${res.url()}`);
  });

  await page.goto('/', { waitUntil: 'networkidle' });
  // Scroll through the page so lazy images are requested too.
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 30));
    }
  });
  await page.waitForLoadState('networkidle');

  expect(problems).toEqual([]);
});

test('AC-14: image credits and README are complete', async ({ page }) => {
  const creditsPath = path.join(ROOT, 'public/images/CREDITS.md');
  expect(existsSync(creditsPath)).toBe(true);
  const credits = readFileSync(creditsPath, 'utf8');

  await page.goto('/');
  const usedImages = await page.evaluate(() => {
    const files = Array.from(document.querySelectorAll('img')).map((img) =>
      new URL(img.getAttribute('src'), location.href).pathname,
    );
    const heroBg = getComputedStyle(document.querySelector('#home')).backgroundImage;
    for (const match of heroBg.matchAll(/url\("?([^")]+)"?\)/g)) files.push(new URL(match[1]).pathname);
    return files.filter((p) => p.startsWith('/images/')).map((p) => p.split('/').pop());
  });
  expect(usedImages.length).toBeGreaterThanOrEqual(7); // hero + ≥6 dishes

  for (const file of usedImages) {
    const line = credits.split('\n').find((l) => l.includes(file));
    expect(line, `${file} listed in CREDITS.md`).toBeTruthy();
    expect(line, `${file} has a source URL or is marked placeholder`).toMatch(/https?:\/\/|placeholder/i);
    expect(existsSync(path.join(ROOT, 'public/images', file)), `${file} exists`).toBe(true);
  }

  const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  for (const command of ['npm run dev', 'npm run build', 'npm test']) {
    expect(readme).toContain(command);
  }
  expect(readme).toMatch(/^#+ .*editing copy/im);
  expect(readme).toMatch(/^#+ .*swapping images/im);
});
