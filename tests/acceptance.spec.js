// QA acceptance tests for the Saffron & Sage landing page — one or more tests per AC in prd.md.
// Black-box: everything goes through the served page (vite preview of the production build),
// the built files on disk, or the docs. Production code is never imported.
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W375 = { width: 375, height: 667 };
const W768 = { width: 768, height: 1024 };
const W1280 = { width: 1280, height: 720 };
const NAV = [
  ['Home', '#home'],
  ['About', '/about.html'], // a page link; the home About section is still scroll-spied via data-section
  ['Gallery', '#gallery'],
  ['Contact', '#contact'],
];

const nav = (page) => page.locator('header nav');
const navLinkByName = (page, name) => nav(page).getByRole('link', { name, exact: true });

async function settleScroll(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        let last = -1;
        let same = 0;
        const step = () => {
          same = window.scrollY === last ? same + 1 : 0;
          last = window.scrollY;
          if (same >= 12) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
  );
}

async function activeNavHrefs(page) {
  return nav(page)
    .locator('a')
    .evaluateAll((links) =>
      links
        .filter((a) => a.getAttribute('aria-current') === 'true' || a.classList.contains('active'))
        .map((a) => (a.dataset.section ? `#${a.dataset.section}` : a.getAttribute('href'))),
    );
}

/* ------------------------------------------------------------------ colour maths (WCAG 2.x) */
function rgba(str) {
  const m = str.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/);
  if (!m) throw new Error(`unparseable colour ${str}`);
  let a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : Number(m[4]);
  return { r: +m[1], g: +m[2], b: +m[3], a };
}
const over = (fg, bg) => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a),
  g: fg.g * fg.a + bg.g * (1 - fg.a),
  b: fg.b * fg.a + bg.b * (1 - fg.a),
  a: 1,
});
const lum = ({ r, g, b }) => {
  const c = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
};
const ratio = (x, y) => {
  const [a, b] = [lum(x), lum(y)].sort((p, q) => q - p);
  return (a + 0.05) / (b + 0.05);
};

/* ================================================================== AC-1 */
test('AC-1: production build exists in dist/ and is what the test server serves', async ({ page }) => {
  // `npm run build` is run by the Playwright webServer before preview starts (npm test exit code is
  // recorded in qa-report.md). Here we verify the artefact and that preview serves the built bundle.
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  expect(pkg.scripts.build).toMatch(/vite build/);
  expect(pkg.scripts.test).toMatch(/playwright test/);
  expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
  expect(Object.keys(pkg.devDependencies).sort()).toEqual(['@playwright/test', 'vite']);

  const distIndex = path.join(ROOT, 'dist/index.html');
  expect(existsSync(distIndex)).toBe(true);
  const built = readFileSync(distIndex, 'utf8');
  expect(built).toMatch(/\/assets\/index-[\w-]+\.js/); // hashed bundle => real production build

  await page.goto('/');
  const scriptSrc = await page.locator('script[type="module"]').getAttribute('src');
  expect(scriptSrc).toMatch(/^\/assets\/index-[\w-]+\.js$/);
});

/* ================================================================== AC-2 */
test('AC-2: header nav, main with home/about/gallery sections in order, then footer#contact', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('header nav')).toHaveCount(1);
  await expect(page.locator('main')).toHaveCount(1);
  for (const id of ['home', 'about', 'gallery']) {
    await expect(page.locator(`main section#${id}`)).toHaveCount(1);
  }
  await expect(page.locator('footer#contact')).toHaveCount(1);

  const order = await page.evaluate(() => {
    const els = ['section#home', 'section#about', 'section#gallery', 'footer#contact'].map((s) =>
      document.querySelector(s),
    );
    const follows = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    return {
      ordered: els.every((el, i) => i === 0 || follows(els[i - 1], el)),
      footerOutsideMain: !document.querySelector('main').contains(els[3]),
      footerAfterMain: follows(document.querySelector('main'), els[3]),
    };
  });
  expect(order).toEqual({ ordered: true, footerOutsideMain: true, footerAfterMain: true });
});

/* ================================================================== AC-3 */
test('AC-3: single h1 "Saffron & Sage", visible tagline, View Gallery and Reserve a Table CTAs', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('h1')).toHaveCount(1);
  expect((await page.locator('h1').innerText()).trim()).toBe('Saffron & Sage');
  await expect(page.locator('#home').getByText('Seasonal kitchen, honest flavours', { exact: true })).toBeVisible();

  const view = page.getByRole('link', { name: 'View Gallery', exact: true });
  await expect(view).toHaveCount(1);
  await expect(view).toHaveAttribute('href', '#gallery');
  await expect(view).toBeVisible();

  const reserve = page.getByRole('link', { name: 'Reserve a Table', exact: true });
  await expect(reserve).toHaveCount(1);
  expect(await reserve.getAttribute('href')).toMatch(/^(tel:|mailto:)\S+/);
  await expect(reserve).toBeVisible();
});

/* ================================================================== AC-4 */
test('AC-4: about and gallery have h2; no skipped heading levels; about has >=2 paragraphs', async ({
  page,
}) => {
  await page.goto('/');
  expect(await page.locator('#about h2').count()).toBeGreaterThanOrEqual(1);
  expect(await page.locator('#gallery h2').count()).toBeGreaterThanOrEqual(1);

  const levels = await page.$$eval('h1,h2,h3,h4,h5,h6', (hs) => hs.map((h) => +h.tagName[1]));
  expect(levels[0]).toBe(1);
  levels.reduce((prev, cur) => {
    expect(cur, `h${cur} after h${prev}`).toBeLessThanOrEqual(prev + 1);
    return cur;
  });

  const paras = await page.$$eval('#about p', (ps) => ps.filter((p) => p.textContent.trim().length > 0).length);
  expect(paras).toBeGreaterThanOrEqual(2);
});

/* ================================================================== AC-5 */
test('AC-5: >=6 gallery images, specific unique alts, lazy, sized, same-origin /images/, loaded', async ({
  page,
  baseURL,
}) => {
  await page.goto('/');
  const imgs = page.locator('#gallery img');
  const n = await imgs.count();
  expect(n).toBeGreaterThanOrEqual(6);

  const info = await imgs.evaluateAll((els) =>
    els.map((el) => ({
      alt: el.getAttribute('alt'),
      loading: el.getAttribute('loading'),
      width: el.getAttribute('width'),
      height: el.getAttribute('height'),
      aspect: getComputedStyle(el).aspectRatio,
      src: el.src,
    })),
  );
  const generic = /^(image|photo|dish|picture|img)\s*\d*$/i;
  for (const [i, im] of info.entries()) {
    expect(im.alt, `img ${i} alt present`).not.toBeNull();
    expect(im.alt.trim(), `img ${i} alt non-empty`).not.toBe('');
    expect(im.alt.trim(), `img ${i} alt specific`).not.toMatch(generic);
    expect(im.alt.trim().split(/\s+/).length, `img ${i} alt is descriptive`).toBeGreaterThanOrEqual(3);
    expect(im.loading).toBe('lazy');
    const sized = (/^\d+$/.test(im.width ?? '') && /^\d+$/.test(im.height ?? '')) || (im.aspect && im.aspect !== 'auto');
    expect(sized, `img ${i} width/height or aspect-ratio`).toBeTruthy();
    const u = new URL(im.src);
    expect(u.origin).toBe(new URL(baseURL).origin);
    expect(u.pathname).toMatch(/^\/images\/[^/]+$/);
  }
  const alts = info.map((im) => im.alt.trim().toLowerCase());
  expect(new Set(alts).size).toBe(alts.length);

  // Every image actually loads (bring each one into view so lazy loading kicks in).
  for (let i = 0; i < n; i += 1) {
    await imgs.nth(i).scrollIntoViewIfNeeded();
    await expect
      .poll(() => imgs.nth(i).evaluate((el) => (el.complete ? el.naturalWidth : 0)), { timeout: 10_000 })
      .toBeGreaterThan(0);
  }
});

/* ================================================================== AC-6 */
for (const [vp, check] of [
  [W375, (c) => expect(c).toBe(1)],
  [W768, (c) => expect(c).toBe(2)],
  [W1280, (c) => expect(c).toBeGreaterThanOrEqual(3)],
]) {
  test(`AC-6: gallery shows the right number of columns at ${vp.width}px`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.goto('/');
    // Measure the images themselves (not their wrappers) and only the first row.
    const columns = await page.$$eval('#gallery img', (els) => {
      const boxes = els.map((el) => el.getBoundingClientRect());
      const firstTop = Math.min(...boxes.map((b) => Math.round(b.top)));
      const firstRow = boxes.filter((b) => Math.abs(Math.round(b.top) - firstTop) < 2);
      const allXs = new Set(boxes.map((b) => Math.round(b.left)));
      return { firstRow: new Set(firstRow.map((b) => Math.round(b.left))).size, all: allXs.size };
    });
    check(columns.firstRow);
    check(columns.all);
  });
}

/* ================================================================== AC-7 */
test('AC-7: footer has address, hours, tel, mailto, named social links and © current year', async ({ page }) => {
  await page.goto('/');
  const f = page.locator('footer#contact');
  await expect(f.locator('address')).toHaveCount(1);
  expect((await f.locator('address').innerText()).trim().length).toBeGreaterThan(5);

  const text = await f.innerText();
  expect(text).toMatch(/hours/i);
  expect(text).toMatch(/\b(mon|tue|wed|thu|fri|sat|sun)/i);
  expect(text).toMatch(/\d{1,2}[:.]\d{2}/);

  await expect(f.locator('a[href^="tel:"]').first()).toBeVisible();
  await expect(f.locator('a[href^="mailto:"]').first()).toBeVisible();

  // Social links: anything that is not tel:/mailto:/a file link, with an accessible name.
  const social = f.getByRole('link', { name: /instagram|facebook|twitter|tripadvisor|x\b|tiktok|youtube/i });
  expect(await social.count()).toBeGreaterThanOrEqual(2);
  for (const link of await social.all()) {
    const name = ((await link.getAttribute('aria-label')) || (await link.innerText())).trim();
    expect(name.length).toBeGreaterThan(0);
  }

  const year = String(new Date().getFullYear());
  const copyright = f.getByText('©');
  await expect(copyright).toHaveCount(1);
  await expect(copyright).toContainText(year);
});

/* ================================================================== AC-8 */
test('AC-8: header links to all sections; Gallery click lands below sticky header; header sticks', async ({
  page,
}) => {
  await page.setViewportSize(W1280);
  await page.goto('/');
  for (const [, href] of NAV) {
    await expect(page.locator(`header a[href="${href}"]`).first()).toBeAttached();
    await expect(nav(page).locator(`a[href="${href}"]`)).toHaveCount(1);
  }

  await navLinkByName(page, 'Gallery').click();
  await expect(page).toHaveURL(/#gallery$/);
  await settleScroll(page);
  const header = page.locator('header').first();
  const hb = await header.boundingBox();
  const h2 = await page.locator('#gallery h2').boundingBox();
  expect(h2.y).toBeGreaterThanOrEqual(hb.y + hb.height - 0.5);
  expect(h2.y + h2.height).toBeLessThanOrEqual(W1280.height);
  expect(hb.y).toBe(0);

  // Same for the About section (reached by hash: the About nav link now opens /about.html).
  await page.evaluate(() => {
    window.location.hash = '#about';
  });
  await expect(page).toHaveURL(/#about$/);
  await settleScroll(page);
  const aboutH2 = await page.locator('#about h2').boundingBox();
  expect(aboutH2.y).toBeGreaterThanOrEqual(hb.height - 0.5);
  expect(aboutH2.y + aboutH2.height).toBeLessThanOrEqual(W1280.height);

  // Scroll to the footer: header still pinned at y=0 and visible.
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  await settleScroll(page);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
  await expect(page.locator('footer#contact')).toBeInViewport();
  const after = await header.boundingBox();
  expect(after.y).toBe(0);
  await expect(header).toBeInViewport();
  await expect(navLinkByName(page, 'Home')).toBeInViewport();
});

/* ================================================================== AC-9 */
test('AC-9: reaching About then Gallery marks exactly that link as current', async ({ page }) => {
  await page.setViewportSize(W1280);
  await page.goto('/');
  // The About nav link opens /about.html, so reach the About section via its hash.
  await page.evaluate(() => {
    window.location.hash = '#about';
  });
  await settleScroll(page);
  await expect.poll(() => activeNavHrefs(page)).toEqual(['#about']);
  await navLinkByName(page, 'Gallery').click();
  await settleScroll(page);
  await expect.poll(() => activeNavHrefs(page)).toEqual(['#gallery']);
});

test('AC-9: navigating via URL hash (deep link and hashchange) marks the matching link only', async ({
  page,
}) => {
  await page.setViewportSize(W1280);
  await page.goto('/#gallery');
  await settleScroll(page);
  await expect.poll(() => activeNavHrefs(page)).toEqual(['#gallery']);

  await page.evaluate(() => {
    window.location.hash = '#about';
  });
  await settleScroll(page);
  await expect.poll(() => activeNavHrefs(page)).toEqual(['#about']);

  await page.evaluate(() => {
    window.location.hash = '#gallery';
  });
  await settleScroll(page);
  await expect.poll(() => activeNavHrefs(page)).toEqual(['#gallery']);
});

test('AC-9: manual scrolling updates the single current link', async ({ page }) => {
  await page.setViewportSize(W1280);
  await page.goto('/');
  await expect.poll(() => activeNavHrefs(page)).toEqual(['#home']);
  // Scroll the gallery heading to just below the header by hand (wheel), no anchor involved.
  const target = await page.evaluate(
    () => document.querySelector('#gallery').getBoundingClientRect().top + window.scrollY - 60,
  );
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, target);
  await settleScroll(page);
  await expect.poll(() => activeNavHrefs(page)).toEqual(['#gallery']);
});

/* ================================================================== AC-10 */
test('AC-10: at 375px the toggle opens/closes the menu with aria-expanded; a link closes it', async ({
  page,
}) => {
  await page.setViewportSize(W375);
  await page.goto('/');
  const toggle = nav(page).getByRole('button');
  await expect(toggle).toHaveCount(1);
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  const controls = await toggle.getAttribute('aria-controls');
  expect(controls).toBeTruthy();
  const menu = page.locator(`[id="${controls}"]`);
  await expect(menu).toHaveCount(1);
  for (const [name] of NAV) await expect(navLinkByName(page, name)).toBeHidden();

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(menu).toBeVisible();
  for (const [name] of NAV) await expect(navLinkByName(page, name)).toBeVisible();

  // Toggle again closes it.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  for (const [name] of NAV) await expect(navLinkByName(page, name)).toBeHidden();

  // Each nav link closes the menu after navigating.
  for (const [name, href] of NAV) {
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await navLinkByName(page, name).click();
    if (href === '/about.html') {
      // Page link: lands on the About page (whose own menu starts closed); return home to continue.
      await expect(page).toHaveURL(/\/about\.html$/);
      await page.goto('/');
      continue;
    }
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(navLinkByName(page, name)).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
  }
});

test('AC-10: at 1280px the links are visible directly and no toggle is shown', async ({ page }) => {
  await page.setViewportSize(W1280);
  await page.goto('/');
  await expect(nav(page).getByRole('button')).toBeHidden();
  for (const [name] of NAV) await expect(navLinkByName(page, name)).toBeVisible();
});

/* ================================================================== AC-11 */
for (const vp of [W375, W768, W1280]) {
  test(`AC-11: no horizontal overflow at ${vp.width}px (top, scrolled, menu open)`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.goto('/');
    const overflow = () =>
      page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    let m = await overflow();
    expect(m.sw).toBeLessThanOrEqual(m.iw);

    // after every lazy image has loaded
    await page.evaluate(async () => {
      for (const img of document.querySelectorAll('img')) {
        img.loading = 'eager';
      }
      await Promise.all(
        Array.from(document.images).map((i) => (i.complete ? null : new Promise((r) => (i.onload = i.onerror = r)))),
      );
    });
    m = await overflow();
    expect(m.sw).toBeLessThanOrEqual(m.iw);

    const toggle = nav(page).getByRole('button');
    if (await toggle.isVisible()) {
      await toggle.click();
      m = await overflow();
      expect(m.sw).toBeLessThanOrEqual(m.iw);
    }
  });
}

/* ================================================================== AC-12 */
test('AC-12: nav links, toggle and hero CTAs are at least 44x44 px at 375px', async ({ page }) => {
  await page.setViewportSize(W375);
  await page.goto('/');
  const check = async (loc, label) => {
    const b = await loc.boundingBox();
    expect(b, `${label} rendered`).not.toBeNull();
    expect(b.width, `${label} width`).toBeGreaterThanOrEqual(44);
    expect(b.height, `${label} height`).toBeGreaterThanOrEqual(44);
  };
  const toggle = nav(page).getByRole('button');
  await check(toggle, 'nav toggle');
  await check(page.getByRole('link', { name: 'View Gallery', exact: true }), 'View Gallery');
  await check(page.getByRole('link', { name: 'Reserve a Table', exact: true }), 'Reserve a Table');
  await toggle.click();
  for (const [name] of NAV) await check(navLinkByName(page, name), `nav ${name}`);
});

test('AC-12: every keyboard-focused link and button shows a visible focus style', async ({ page }) => {
  await page.setViewportSize(W1280);
  await page.goto('/');
  const total = await page.$$eval('a[href], button', (els) => els.filter((e) => e.offsetParent !== null).length);
  const seen = [];
  for (let i = 0; i < total + 2; i += 1) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      return {
        label: `${el.tagName} ${el.getAttribute('href') ?? ''} ${(el.getAttribute('aria-label') || el.textContent).trim()}`,
        outline: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0,
        shadow: s.boxShadow !== 'none',
      };
    });
    if (!f) break;
    if (seen.includes(f.label)) break;
    seen.push(f.label);
    expect(f.outline || f.shadow, `visible focus on ${f.label}`).toBe(true);
  }
  // Tabbing reached the nav, the hero CTAs and the footer links.
  expect(seen.some((l) => l.includes('#gallery Gallery'))).toBe(true);
  expect(seen.some((l) => l.includes('Reserve a Table'))).toBe(true);
  expect(seen.some((l) => l.startsWith('A mailto:'))).toBe(true);
});

test('AC-12: mobile nav toggle shows a visible focus style', async ({ page }) => {
  await page.setViewportSize(W375);
  await page.goto('/');
  const toggle = nav(page).getByRole('button');
  // Tab until the toggle has focus
  for (let i = 0; i < 5; i += 1) {
    await page.keyboard.press('Tab');
    if (await toggle.evaluate((el) => el === document.activeElement)) break;
  }
  await expect(toggle).toBeFocused();
  const visible = await toggle.evaluate((el) => {
    const s = getComputedStyle(el);
    return (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none';
  });
  expect(visible).toBe(true);
});

test('AC-12: hero h1 and tagline contrast >= 4.5:1 against the overlay (worst case: white photo)', async ({
  page,
}) => {
  await page.goto('/');
  const s = await page.evaluate(() => {
    const hero = document.querySelector('#home');
    return {
      bg: getComputedStyle(hero).backgroundImage,
      h1: getComputedStyle(hero.querySelector('h1')).color,
      tagline: getComputedStyle(
        Array.from(hero.querySelectorAll('p')).find((p) => p.textContent.includes('Seasonal kitchen')),
      ).color,
    };
  });
  // The overlay must be the top layer above a local photo.
  expect(s.bg).toMatch(/^linear-gradient/);
  expect(s.bg).toMatch(/url\("?https?:\/\/localhost:\d+\/images\//);
  const gradient = s.bg.slice(0, s.bg.indexOf('url('));
  const stops = (gradient.match(/rgba?\([^)]*\)/g) || []).map(rgba);
  expect(stops.length).toBeGreaterThanOrEqual(1);

  const white = { r: 255, g: 255, b: 255, a: 1 };
  const black = { r: 0, g: 0, b: 0, a: 1 };
  for (const [name, colour] of Object.entries({ h1: s.h1, tagline: s.tagline })) {
    for (const stop of stops) {
      for (const photo of [white, black]) {
        const bg = over(stop, photo);
        const fg = over(rgba(colour), bg);
        expect(ratio(fg, bg), `${name} on ${JSON.stringify(stop)} over ${photo === white ? 'white' : 'black'}`)
          .toBeGreaterThanOrEqual(4.5);
      }
    }
  }
});

/* ================================================================== AC-13 */
for (const vp of [W375, W1280]) {
  test(`AC-13: clean load at ${vp.width}px — no console errors, page errors, 4xx/5xx or foreign hosts`, async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize(vp);
    const origin = new URL(baseURL).origin;
    const issues = [];
    const requested = [];
    page.on('console', (m) => m.type() === 'error' && issues.push(`console.error: ${m.text()}`));
    page.on('pageerror', (e) => issues.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => issues.push(`failed: ${r.url()} ${r.failure()?.errorText}`));
    page.on('request', (r) => {
      requested.push(r.url());
      const u = new URL(r.url());
      if (u.protocol !== 'data:' && u.origin !== origin) issues.push(`foreign: ${r.url()}`);
    });
    page.on('response', (r) => r.status() >= 400 && issues.push(`HTTP ${r.status()} ${r.url()}`));

    await page.goto('/', { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
      const h = document.documentElement.scrollHeight;
      for (let y = 0; y <= h; y += 300) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 40));
      }
    });
    await page.waitForLoadState('networkidle');
    // interact a little too
    if (vp.width < 768) {
      await nav(page).getByRole('button').click();
      await navLinkByName(page, 'Gallery').click();
    } else {
      await navLinkByName(page, 'About').click();
    }
    await page.waitForLoadState('networkidle');

    expect(issues).toEqual([]);
    // All gallery images were actually requested.
    const galleryCount = await page.locator('#gallery img').count();
    expect(requested.filter((u) => /\/images\/.+\.(jpe?g|png|webp|avif|svg)$/i.test(u)).length).toBeGreaterThanOrEqual(
      galleryCount,
    );
  });
}

/* ================================================================== AC-14 */
test('AC-14: CREDITS.md lists every image used (hero + gallery) with source/author or placeholder', async ({
  page,
}) => {
  const creditsFile = path.join(ROOT, 'public/images/CREDITS.md');
  expect(existsSync(creditsFile)).toBe(true);
  const credits = readFileSync(creditsFile, 'utf8');

  await page.goto('/');
  const files = await page.evaluate(() => {
    const out = new Set();
    for (const img of document.images) out.add(new URL(img.src).pathname);
    for (const el of document.querySelectorAll('*')) {
      const bg = getComputedStyle(el).backgroundImage;
      for (const m of bg.matchAll(/url\("?([^")]+)"?\)/g)) out.add(new URL(m[1], location.href).pathname);
    }
    return [...out].filter((p) => p.startsWith('/images/')).map((p) => decodeURIComponent(p.split('/').pop()));
  });
  expect(files.length).toBeGreaterThanOrEqual(7);
  for (const file of files) {
    const row = credits.split('\n').find((l) => l.includes(file));
    expect(row, `${file} in CREDITS.md`).toBeTruthy();
    const hasSource = /https?:\/\/\S+/.test(row) && /\|\s*[^|`]*[A-Za-z][^|]*\|/.test(row);
    expect(hasSource || /placeholder/i.test(row), `${file} has source+author or placeholder`).toBe(true);
  }
  // Every image file on disk is also credited.
  const { readdirSync } = await import('node:fs');
  for (const f of readdirSync(path.join(ROOT, 'public/images')).filter((x) => !x.endsWith('.md'))) {
    expect(credits, `${f} credited`).toContain(f);
  }
});

test('AC-14: README documents dev/build/test commands, editing copy and swapping images', async () => {
  const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  for (const cmd of ['npm run dev', 'npm run build', 'npm test']) expect(readme).toContain(cmd);
  expect(readme).toMatch(/npx playwright install/);
  expect(readme).toMatch(/^#{1,6}\s.*edit(ing)?\s+(the\s+)?copy/im);
  expect(readme).toMatch(/^#{1,6}\s.*(swap(ping)?|replac(e|ing))\s+(the\s+)?images?/im);
  // The swapping-images section mentions alt text and CREDITS.md.
  const section = readme.split(/^#{1,6}\s.*swapping images.*$/im)[1]?.split(/^#{1,2}\s/m)[0] ?? '';
  expect(section).toMatch(/alt/i);
  expect(section).toMatch(/CREDITS\.md/);
});

// ---- About page (vision and mission) acceptance tests ----
test.describe('About page', () => {
  const norm = (s) => s.replace(/\/assets\/[\w-]+\.(js|css)/g, '/assets/X.$1').replace(/\s+/g, ' ').trim();

  test('AC-1: built index.html matches original bcfa2e4 except the allowed changes', () => {
    const orig = norm(execSync('git show bcfa2e4:dist/index.html', { encoding: 'utf8' }));
    let built = norm(readFileSync(path.join(ROOT, 'dist/index.html'), 'utf8'));
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
    expect(readFileSync(path.join(ROOT, 'vite.config.js'), 'utf8')).toContain('about.html');
    const config = readFileSync(path.join(ROOT, 'playwright.config.js'), 'utf8');
    expect(config).toContain('const PORT = 4173');
    expect(config).toContain('npm run build');
  });
});
