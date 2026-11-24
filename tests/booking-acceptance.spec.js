// QA acceptance tests for the booking page (prd.md "Booking page", AC-1 … AC-14).
// Black-box and independent of tests/booking.spec.js: everything goes through the served production
// build (vite preview), the built files on disk, git, or the docs. Production code is never imported
// or changed. Some tests are labelled "(control)": they prove that an assertion used elsewhere would
// actually catch the defect it is meant to catch.
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W320 = { width: 320, height: 640 };
const W375 = { width: 375, height: 667 };
const W1280 = { width: 1280, height: 720 };
const LA = 'America/Los_Angeles';
const SUN_0900 = '2026-06-14T09:00:00-07:00';
const SUN_2230 = '2026-06-14T22:30:00-07:00'; // 2026-06-15T05:30Z

/* ------------------------------------------------------------------ helpers */

const $ = {
  form: (p) => p.locator('#booking-form'),
  name: (p) => p.locator('#booking-name'),
  phone: (p) => p.locator('#booking-phone'),
  email: (p) => p.locator('#booking-email'),
  date: (p) => p.locator('#booking-date'),
  time: (p) => p.locator('#booking-time'),
  party: (p) => p.locator('#booking-party'),
  notes: (p) => p.locator('#booking-notes'),
  submit: (p) => p.getByRole('button', { name: 'Request a table', exact: true }),
  panel: (p) => p.locator('[role="status"]'),
};
const navLinks = (p) => p.locator('header nav a');
const navLink = (p, name) => p.locator('header nav').getByRole('link', { name, exact: true });

async function openBooking(page, instant) {
  if (instant) await page.clock.setFixedTime(new Date(instant));
  return page.goto('/booking.html');
}

const options = (select) =>
  select.locator('option').evaluateAll((os) => os.map((o) => [o.value, o.textContent.trim()]));

async function fillValid(page) {
  await $.name(page).fill('Ada Lovelace');
  await $.phone(page).fill('+1 555 0199');
  await $.date(page).fill('2026-06-21');
  await $.time(page).selectOption('19:00');
  await $.party(page).selectOption('4');
}

/** Every request the page starts from now on (navigations, scripts, fetch, XHR, beacons…). */
function recordRequests(page) {
  const seen = [];
  page.on('request', (r) =>
    seen.push({ method: r.method(), url: r.url(), body: r.method() === 'POST' ? r.postDataJSON() : null }),
  );
  return seen;
}

/** Installs counters on every client-side way to send or store data, before any page script runs. */
const installSendSpies = (page) =>
  page.addInitScript(() => {
    const calls = [];
    window.__sends = calls;
    const wrap = (obj, key, label) => {
      const orig = obj[key];
      if (typeof orig !== 'function') return;
      obj[key] = function (...args) {
        calls.push(label);
        return orig.apply(this, args);
      };
    };
    wrap(window, 'fetch', 'fetch');
    wrap(XMLHttpRequest.prototype, 'open', 'xhr');
    wrap(navigator, 'sendBeacon', 'beacon');
    wrap(Storage.prototype, 'setItem', 'storage');
    const OrigWS = window.WebSocket;
    window.WebSocket = function (...a) {
      calls.push('websocket');
      return new OrigWS(...a);
    };
    const cookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    Object.defineProperty(document, 'cookie', {
      get: () => cookie.get.call(document),
      set: (v) => {
        calls.push('cookie');
        cookie.set.call(document, v);
      },
    });
  });

/** The ids listed in aria-describedby. */
const describedBy = async (loc) => ((await loc.getAttribute('aria-describedby')) ?? '').split(/\s+/).filter(Boolean);

/* WCAG 2.x contrast */
function rgba(s) {
  const m = s.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/);
  if (!m) throw new Error(`unparseable colour ${s}`);
  const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : Number(m[4]);
  return { r: +m[1], g: +m[2], b: +m[3], a };
}
const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
const lum = ({ r, g, b }) => {
  const c = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
};
const ratio = (x, y) => {
  const [a, b] = [lum(x), lum(y)].sort((p, q) => q - p);
  return (a + 0.05) / (b + 0.05);
};
/** Contrast of an element's text against its effective background (ancestor backgrounds composited). */
async function contrastOf(loc) {
  const { fg, bgs } = await loc.evaluate((el) => {
    const bgs = [];
    for (let n = el; n; n = n.parentElement) bgs.push(getComputedStyle(n).backgroundColor);
    return { fg: getComputedStyle(el).color, bgs };
  });
  let bg = { r: 255, g: 255, b: 255, a: 1 };
  for (const c of bgs.reverse()) bg = over(rgba(c.replace('transparent', 'rgba(0, 0, 0, 0)')), bg);
  return ratio(over(rgba(fg), bg), bg);
}

const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/* ================================================================== AC-1 */

test('AC-1: vite.config.js lists both pages and the build emits both', async ({ page }) => {
  const config = readFileSync(path.join(ROOT, 'vite.config.js'), 'utf8');
  expect(config).toMatch(/rollupOptions[\s\S]*input/);
  expect(config).toMatch(/['"`/]index\.html['"`]/);
  expect(config).toMatch(/['"`/]booking\.html['"`]/);

  const distBooking = path.join(ROOT, 'dist/booking.html');
  expect(existsSync(path.join(ROOT, 'dist/index.html'))).toBe(true);
  expect(existsSync(distBooking)).toBe(true);
  const built = readFileSync(distBooking, 'utf8');
  expect(built).not.toContain('/src/'); // sources were bundled, not linked raw
  for (const [, src] of built.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) {
    expect(existsSync(path.join(ROOT, 'dist', src)), src).toBe(true);
  }

  const res = await page.goto('/booking.html');
  expect(res.status()).toBe(200);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveText('Book a table');
  const title = await page.title();
  expect(title).toContain('Book a table');
  expect(title).toContain('Saffron & Sage');
});

/* ================================================================== AC-2 */

test('AC-2: booking.html footer matches the home page and the page loads with no errors or foreign requests', async ({
  page,
  baseURL,
}) => {
  await page.setViewportSize(W1280);
  const origin = new URL(baseURL).origin;
  await page.goto('/');
  const homeFooter = await page.locator('footer#contact').innerText();
  const homeHours = await page.locator('footer#contact .hours').innerText();

  const problems = [];
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.protocol !== 'data:' && u.origin !== origin) problems.push(`foreign: ${r.url()}`);
  });
  page.on('response', (r) => r.status() >= 400 && problems.push(`HTTP ${r.status()} ${r.url()}`));
  await page.goto('/booking.html', { waitUntil: 'networkidle' });

  await expect(page.locator('header .site-nav')).toHaveCount(1);
  await expect(page.locator('main#main')).toHaveCount(1);
  await expect(page.locator('footer#contact')).toHaveCount(1);
  expect(await page.locator('footer#contact .hours').innerText()).toBe(homeHours);
  await expect(page.locator('footer#contact a[href="tel:+15550100"]')).toHaveCount(1);
  expect(await page.locator('footer#contact').innerText()).toBe(homeFooter); // same footer, copied verbatim
  expect(problems).toEqual([]);
});

/* ================================================================== AC-3 */

test('AC-3: nav order/hrefs on both pages, one current link on booking.html, styled differently', async ({ page }) => {
  await page.setViewportSize(W1280);
  const state = () =>
    navLinks(page).evaluateAll((as) => as.map((a) => [a.textContent.trim(), a.getAttribute('href'), a.getAttribute('aria-current')]));

  await page.goto('/');
  const home = await state();
  expect(home.map(([n, h]) => [n, h])).toEqual([
    ['Home', '#home'],
    ['About', '#about'],
    ['Gallery', '#gallery'],
    ['Contact', '#contact'],
    ['Book', '/booking.html'],
  ]);
  expect(home[4][2]).toBeNull();

  await page.goto('/booking.html');
  const booking = await state();
  expect(booking).toEqual([
    ['Home', '/#home', null],
    ['About', '/#about', null],
    ['Gallery', '/#gallery', null],
    ['Contact', '#contact', null],
    ['Book', '/booking.html', 'page'],
  ]);
  await expect(navLink(page, 'Book')).toHaveAccessibleName('Book');

  const look = (name) =>
    navLink(page, name).evaluate((el) => {
      const a = getComputedStyle(el, '::after');
      const sx = a.transform === 'none' ? 1 : new DOMMatrixReadOnly(a.transform).a;
      const visible = a.content !== 'none' && a.display !== 'none' && a.visibility !== 'hidden' && parseFloat(a.opacity) > 0;
      return { color: getComputedStyle(el).color, underline: visible ? sx * parseFloat(a.width) * (parseFloat(a.height) || 1) : 0 };
    });
  await expect.poll(async () => (await look('Book')).underline).toBeGreaterThan(0);
  for (const inactive of ['Home', 'Gallery', 'Contact']) {
    const [book, other] = [await look('Book'), await look(inactive)];
    expect(book.color, inactive).not.toBe(other.color);
    expect(other.underline, inactive).toBe(0);
  }
});

test('AC-3: Home from booking.html lands on the home page with Home as the single current link', async ({ page }) => {
  await page.setViewportSize(W1280);
  await page.goto('/booking.html');
  await navLink(page, 'Home').click();
  await expect(page).toHaveURL(/\/#home$/);
  await expect(navLink(page, 'Home')).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('header nav a[aria-current]')).toHaveCount(1);
});

/* ================================================================== AC-4 */

test('AC-4: on booking.html, keyboard Contact and resize do not let scroll-spy steal Book', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize(W1280);
  await page.goto('/booking.html');
  const current = () => page.locator('header nav a[aria-current]').evaluateAll((as) => as.map((a) => [a.textContent.trim(), a.getAttribute('aria-current')]));

  await navLink(page, 'Contact').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#contact$/);
  await expect(page.locator('footer#contact')).toBeInViewport();
  await page.waitForTimeout(400); // let scroll / scrollend handlers run
  expect(await current()).toEqual([['Book', 'page']]);

  await page.mouse.wheel(0, -5000);
  await page.waitForTimeout(400);
  await page.setViewportSize({ width: 900, height: 700 });
  await page.waitForTimeout(200);
  expect(await current()).toEqual([['Book', 'page']]);
  await expect(navLink(page, 'Contact')).not.toHaveAttribute('aria-current');
  expect(errors).toEqual([]);
});

/* ================================================================== AC-5 */

test('AC-5: mobile menu on booking.html closes on Contact and on resize; brand on / closes it', async ({ page }) => {
  await page.setViewportSize(W375);
  await page.goto('/booking.html');
  const toggle = page.locator('.nav-toggle');
  await expect(toggle).toHaveAttribute('aria-controls', 'primary-menu');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await navLink(page, 'Contact').click();
  await expect(page).toHaveURL(/\/booking\.html#contact$/); // same page: no reload hides a broken close
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#primary-menu')).toBeHidden();

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.setViewportSize(W1280);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  await page.setViewportSize(W375);
  await page.goto('/');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const urlBefore = page.url();
  await page.locator('header a.brand').click();
  await expect(page).toHaveURL(/\/#home$/);
  expect(new URL(page.url()).pathname).toBe(new URL(urlBefore).pathname);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

/* ================================================================== AC-6 */

test('AC-6: Reserve a Table (keyboard) opens booking.html; the footer keeps the tel: link', async ({ page }) => {
  await page.goto('/');
  const reserve = page.locator('#home').getByRole('link', { name: 'Reserve a Table', exact: true });
  await expect(reserve).toHaveAttribute('href', '/booking.html');
  await expect(page.locator('footer a[href^="tel:"]')).not.toHaveCount(0);
  await reserve.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/booking\.html$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Book a table');
});

test('AC-6: the two pre-existing CTA tests were updated, not skipped', () => {
  const acc = readFileSync(path.join(ROOT, 'tests/acceptance.spec.js'), 'utf8');
  const land = readFileSync(path.join(ROOT, 'tests/landing.spec.js'), 'utf8');
  for (const src of [acc, land]) {
    expect(src).toMatch(/Reserve a Table[\s\S]{0,400}\/booking\.html/);
    expect(src).not.toMatch(/\b(test|describe)\.(skip|fixme)\b/);
  }
});

/* ================================================================== AC-7 */

test.describe('Booking form', () => {
  test.use({ timezoneId: LA });

  // The clock is fixed in June 2026, so the real API would reject these dates: mock it with a 201.
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/bookings', (route) =>
      route.fulfill({ status: 201, contentType: 'application/json', body: '{"id":1,"created_at":"2026-06-14T16:00:00.000Z"}' }),
    );
  });

  test('AC-7: no action, accessible names from visible labels, required set, party size 1–8', async ({ page }) => {
    await openBooking(page, SUN_0900);
    expect(await $.form(page).evaluate((f) => f.hasAttribute('action'))).toBe(false);

    const expected = [
      ['name', /^Name\b/, true],
      ['phone', /^Phone\b/, true],
      ['email', /^Email\b/, false],
      ['date', /^Date\b/, true],
      ['time', /^Time\b/, true],
      ['party', /^Party size\b/, true],
      ['notes', /^Notes\b/, false],
    ];
    for (const [key, nameRe, required] of expected) {
      const el = $[key](page);
      await expect(el, key).toHaveAccessibleName(nameRe);
      const label = await el.evaluate((e) => (e.labels.length ? e.labels[0].id || e.labels[0].htmlFor : null));
      expect(label, `${key} has a <label for>`).toBeTruthy();
      await expect(page.locator(`label[for="${await el.getAttribute('id')}"]`), key).toBeVisible();
      expect(await el.evaluate((e) => e.required), key).toBe(required);
    }
    await expect(page.getByRole('textbox', { name: /^Name\b/ })).toHaveAttribute('autocomplete', 'name');
    await expect($.phone(page)).toHaveAttribute('type', 'tel');
    await expect($.email(page)).toHaveAttribute('type', 'email');
    await expect($.date(page)).toHaveAttribute('type', 'date');
    expect(await $.time(page).evaluate((e) => e.tagName)).toBe('SELECT');

    const party = page.getByRole('combobox', { name: /^Party size\b/ });
    expect((await options(party)).map(([v]) => v)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    await expect(party).toHaveValue('2');
    await expect(party).toHaveAccessibleDescription(/For 9\+ guests please call us/);
  });

  /* ================================================================== AC-8 */

  test('AC-8: the fixed clock and time zone really put the page on Sunday 14 June locally, 15 June in UTC', async ({ page }) => {
    await openBooking(page, SUN_2230);
    const env = await page.evaluate(async () => {
      const a = Date.now();
      await new Promise((r) => setTimeout(r, 300));
      const d = new Date();
      return {
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        local: [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getDay(), d.getHours(), d.getMinutes()],
        utcDate: d.getUTCDate(),
        frozen: Date.now() === a,
      };
    });
    expect(env).toEqual({ tz: LA, local: [2026, 6, 14, 0, 22, 30], utcDate: 15, frozen: true });
  });

  test('AC-8: date min/max are local, and today has no times left at 22:30', async ({ page }) => {
    await openBooking(page, SUN_2230);
    await expect($.date(page)).toHaveAttribute('min', '2026-06-14');
    await expect($.date(page)).toHaveAttribute('max', '2026-08-13');
    await $.date(page).fill('2026-06-14');
    expect(await options($.time(page))).toEqual([['', 'No times left today – choose another date']]);
  });

  /* ================================================================== AC-9 */

  test('AC-9: slot lists per weekday follow the footer opening hours (last seating 1h before close)', async ({ page }) => {
    await openBooking(page, SUN_0900);
    expect(await options($.time(page))).toEqual([['', 'Choose a date first']]);

    // Read the hours from the footer itself, so the JS constant is checked against what guests see.
    const rows = await page.locator('footer .hours__row').evaluateAll((rs) =>
      rs.map((r) => [r.querySelector('dt').textContent.trim(), r.querySelector('dd').textContent.match(/\d\d:\d\d/g)]),
    );
    const hoursFor = (label) => rows.find(([dt]) => dt.startsWith(label))[1];
    const toMin = (t) => +t.slice(0, 2) * 60 + +t.slice(3);
    const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const expectedSlots = ([open, close]) => {
      const out = [];
      for (let m = toMin(open); m <= toMin(close) - 60; m += 30) out.push(fmt(m));
      return out;
    };

    const week = [
      ['2026-06-15', 'Mon'],
      ['2026-06-16', 'Mon'],
      ['2026-06-17', 'Mon'],
      ['2026-06-18', 'Mon'],
      ['2026-06-19', 'Fri'],
      ['2026-06-20', 'Fri'],
      ['2026-06-21', 'Sunday'],
    ];
    for (const [date, label] of week) {
      await $.date(page).fill(date);
      const opts = await options($.time(page));
      expect(opts[0], date).toEqual(['', 'Choose a time']);
      expect(opts.slice(1).map(([v]) => v), date).toEqual(expectedSlots(hoursFor(label)));
    }
    // The PRD's explicit counts.
    await $.date(page).fill('2026-06-21');
    expect((await options($.time(page))).length - 1).toBe(19);
    await $.date(page).fill('2026-06-15');
    expect((await options($.time(page))).length - 1).toBe(19);
    await $.date(page).fill('2026-06-19');
    expect((await options($.time(page))).length - 1).toBe(21);
  });

  test('AC-9: on today at 14:10 the list starts at 14:30 and ends at 20:00', async ({ page }) => {
    await openBooking(page, '2026-06-14T14:10:00-07:00');
    await $.date(page).fill('2026-06-14');
    const slots = (await options($.time(page))).slice(1).map(([v]) => v);
    expect(slots[0]).toBe('14:30');
    expect(slots.at(-1)).toBe('20:00');
    expect(slots).toHaveLength(12);
  });

  /* ================================================================== AC-10 */

  test('AC-10: empty submit: no request, URL kept, focus on Name, linked text errors on the 4 fields', async ({ page }) => {
    await openBooking(page, SUN_0900);
    const url = page.url();
    const requests = recordRequests(page);
    await $.submit(page).click();
    await page.waitForTimeout(300);

    expect(requests).toEqual([]);
    expect(page.url()).toBe(url);
    await expect($.panel(page)).toBeHidden();
    await expect($.name(page)).toBeFocused();
    for (const key of ['name', 'phone', 'date', 'time']) {
      const el = $[key](page);
      await expect(el, key).toHaveAttribute('aria-invalid', 'true');
      const ids = await describedBy(el);
      const msgs = [];
      for (const id of ids) {
        const m = page.locator(`[id="${id}"]`);
        if (/error/i.test(id) || (await m.getAttribute('class'))?.includes('error')) msgs.push(m);
      }
      expect(msgs.length, `${key} error linked via aria-describedby`).toBe(1);
      await expect(msgs[0]).toBeVisible();
      expect((await msgs[0].innerText()).trim().length, key).toBeGreaterThan(5);
    }

    await $.name(page).fill('Grace Hopper');
    await expect($.name(page)).not.toHaveAttribute('aria-invalid');
    expect((await describedBy($.name(page))).filter((id) => /error/i.test(id))).toEqual([]);
    await $.submit(page).click();
    await expect($.phone(page)).toBeFocused();

    await $.phone(page).fill('abc');
    await $.submit(page).click();
    await expect($.phone(page)).toHaveAttribute('aria-invalid', 'true');
    await expect($.phone(page)).toBeFocused();
    expect(requests).toEqual([]);
  });

  test('AC-10: pressing Enter in a field submits through the same no-network path', async ({ page }) => {
    await openBooking(page, SUN_0900);
    const url = page.url();
    const requests = recordRequests(page);
    await $.name(page).press('Enter');
    await page.waitForTimeout(300);
    expect(requests).toEqual([]);
    expect(page.url()).toBe(url);
    await expect($.phone(page)).toHaveAttribute('aria-invalid', 'true');
  });

  test('AC-10 (control): the request recorder does catch a form submission that bypasses the handler', async ({ page }) => {
    await openBooking(page, SUN_0900);
    const requests = recordRequests(page);
    // HTMLFormElement#submit() skips the submit event (as if preventDefault were missing) and,
    // because the form is novalidate with no action, navigates to booking.html?name=…
    await Promise.all([page.waitForURL(/\?/), $.form(page).evaluate((f) => HTMLFormElement.prototype.submit.call(f))]);
    expect(requests.some((r) => /\/booking\.html\?/.test(r.url))).toBe(true);
  });

  test('AC-10 (control): without preventDefault in the shipped bundle, the empty-submit assertion fails', async ({ page }) => {
    let mutated = false;
    await page.route(/\/assets\/.*\.js$/, async (route) => {
      const res = await route.fetch();
      let body = await res.text();
      if (body.includes('preventDefault') && /booking/.test(body)) {
        body = body.replaceAll('.preventDefault()', '.stopPropagation()');
        mutated = true;
      }
      await route.fulfill({ response: res, body });
    });
    await openBooking(page, SUN_0900);
    expect(mutated, 'booking bundle found and mutated').toBe(true);
    const requests = recordRequests(page);
    await Promise.all([page.waitForURL(/\?/), $.submit(page).click()]);
    expect(requests.length).toBeGreaterThan(0); // the real test's `requests == []` would fail here
  });

  /* ================================================================== AC-11 */

  test('AC-11: valid submit sends exactly one fetch POST to the API and stores nothing locally (spied APIs, URL, storage, cookies)', async ({ page }) => {
    await installSendSpies(page);
    await openBooking(page, SUN_0900);
    const url = page.url();
    const historyLength = await page.evaluate(() => history.length);
    const requests = recordRequests(page);

    await fillValid(page);
    await $.submit(page).click();
    await expect($.panel(page)).toBeVisible();
    await page.waitForTimeout(1000); // catch deferred sends too

    expect(await page.evaluate(() => window.__sends)).toEqual(['fetch']);
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe('POST');
    expect(new URL(requests[0].url).pathname).toBe('/api/bookings');
    expect(requests[0].body).toMatchObject({
      name: 'Ada Lovelace',
      phone: '+1 555 0199',
      date: '2026-06-21',
      time: '19:00',
      party: 4,
    });
    expect(page.url()).toBe(url);
    expect(page.url()).not.toContain('?');
    expect(await page.evaluate(() => history.length)).toBe(historyLength);
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length, document.cookie])).toEqual([0, 0, '']);
  });

  test('AC-11: the success panel is honest, focused, and echoes the request', async ({ page }) => {
    await openBooking(page, SUN_0900);
    await fillValid(page);
    await $.submit(page).click();
    const panel = $.panel(page);
    await expect(panel).toBeVisible();
    await expect(panel).toBeFocused();
    await expect($.form(page)).toBeHidden();
    const text = await panel.innerText();
    for (const part of ['Ada Lovelace', '4', 'Sunday', '21', 'June', '19:00', 'saved', '+1 (555) 0100']) {
      expect(text, part).toContain(part);
    }
    expect(text).not.toMatch(/\b(booked|confirmed)\b/i);
    await expect(panel.locator('a[href="tel:+15550100"]')).toHaveCount(1);
  });

  /* ================================================================== AC-12 */

  test('AC-12: Make another request restores the form with values kept and focus on Name; resubmit works', async ({ page }) => {
    await openBooking(page, SUN_0900);
    await fillValid(page);
    await $.submit(page).click();
    await expect($.panel(page)).toBeVisible();

    await page.getByRole('button', { name: 'Make another request' }).click();
    await expect($.panel(page)).toBeHidden();
    await expect($.form(page)).toBeVisible();
    await expect($.name(page)).toHaveValue('Ada Lovelace');
    await expect($.time(page)).toHaveValue('19:00');
    await expect($.name(page)).toBeFocused();

    await $.party(page).selectOption('6');
    await $.submit(page).click();
    await expect($.panel(page)).toBeVisible();
    await expect($.panel(page)).toContainText('6');
  });

  /* ================================================================== AC-13 */

  test('AC-13: 320px has no horizontal overflow with all errors shown and after success', async ({ page }) => {
    await page.setViewportSize(W320);
    await openBooking(page, SUN_0900);
    expect(await overflowX(page)).toBeLessThanOrEqual(0);

    await $.email(page).fill('not-an-email');
    await $.notes(page).fill('x'.repeat(40));
    await $.submit(page).click();
    await expect(page.locator('.field__error:visible')).not.toHaveCount(0);
    expect(await overflowX(page)).toBeLessThanOrEqual(0);

    await fillValid(page);
    await $.email(page).fill('ada@example.com');
    await $.submit(page).click();
    await expect($.panel(page)).toBeVisible();
    expect(await overflowX(page)).toBeLessThanOrEqual(0);
  });

  test('AC-13: contrast ≥ 4.5:1 for h1, label, hint, inline error and success text; errors carry text', async ({ page }) => {
    await openBooking(page, SUN_0900);
    expect(await contrastOf(page.locator('h1'))).toBeGreaterThanOrEqual(4.5);
    expect(await contrastOf(page.locator('label[for="booking-date"]'))).toBeGreaterThanOrEqual(4.5);
    expect(await contrastOf(page.locator('#booking-party-hint'))).toBeGreaterThanOrEqual(4.5);

    await $.submit(page).click();
    for (const id of ['booking-name-error', 'booking-phone-error', 'booking-date-error', 'booking-time-error']) {
      const err = page.locator(`#${id}`);
      await expect(err).toBeVisible();
      expect((await err.innerText()).trim(), id).not.toBe('');
      expect(await contrastOf(err), id).toBeGreaterThanOrEqual(4.5);
    }

    await fillValid(page);
    await $.submit(page).click();
    await expect($.panel(page)).toBeVisible();
    for (const loc of [$.panel(page).locator('h2'), $.panel(page).locator('p').first(), $.panel(page).locator('p').last()]) {
      expect(await contrastOf(loc)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

/* ================================================================== AC-14 */

test('AC-14: docs no longer say single-page, README explains the SQLite-backed booking page, deps unchanged', () => {
  const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  expect(readme).not.toMatch(/single[- ]page/i);
  expect(pkg.description).not.toMatch(/single[- ]page/i);
  expect(readme).toMatch(/booking\.html|booking page/i);
  expect(readme).toMatch(/SQLite/);
  expect(readme).toMatch(/BOOKINGS_DB_PATH/);

  // The local `main` branch here is only a ".gitignore" baseline commit; the real main is origin/main
  // (the commit this mission branched from). Compare names AND versions with it.
  const base = execSync('git merge-base HEAD origin/main', { cwd: ROOT }).toString().trim();
  const original = JSON.parse(execSync(`git show ${base}:package.json`, { cwd: ROOT }).toString());
  expect(pkg.dependencies).toEqual(original.dependencies);
  expect(pkg.devDependencies).toEqual(original.devDependencies);
});

test('AC-14: the lockfile root still has only vite and @playwright/test as direct dependencies', () => {
  const lock = JSON.parse(readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const root = lock.packages?.[''] ?? {};
  expect(Object.keys(root.dependencies ?? {})).toEqual([]);
  expect(Object.keys(root.devDependencies ?? {}).sort()).toEqual(['@playwright/test', 'vite']);
});
