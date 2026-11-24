// Tests for the booking page (booking.html), one or more per acceptance criterion of the booking
// prd.md (AC-1 … AC-14). They run against the production build served by `vite preview`.
// Time-dependent tests pin the time zone and the clock, so slot lists and date limits are fixed.
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOBILE = { width: 375, height: 667 };
const NARROW = { width: 320, height: 640 };
const DESKTOP = { width: 1280, height: 720 };
const TIME_ZONE = 'America/Los_Angeles';

// Sunday 14 June 2026 in Los Angeles (UTC-7). At 22:30 it is already 15 June in UTC.
const SUNDAY_MORNING = '2026-06-14T09:00:00-07:00';
const SUNDAY_AFTERNOON = '2026-06-14T14:10:00-07:00';
const SUNDAY_LATE = '2026-06-14T22:30:00-07:00';

/* ------------------------------------------------------------------ helpers */

const navLink = (page, name) => page.locator('header nav').getByRole('link', { name, exact: true });

/** Name, href and aria-current of every header nav link, in order. */
const navState = (page) =>
  page.locator('header nav a').evaluateAll((links) =>
    links.map((a) => ({ name: a.textContent.trim(), href: a.getAttribute('href'), current: a.getAttribute('aria-current') })),
  );

/** Resolves once the window has stopped scrolling (smooth scroll finished). */
async function waitForScrollEnd(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        let last = window.scrollY;
        let stableFrames = 0;
        const tick = () => {
          stableFrames = window.scrollY === last ? stableFrames + 1 : 0;
          last = window.scrollY;
          if (stableFrames >= 10) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}

/** Opens booking.html with the clock fixed at an instant (the time zone comes from test.use). */
async function openBookingAt(page, instant) {
  await page.clock.setFixedTime(new Date(instant));
  await page.goto('/booking.html');
}

const form = (page) => page.locator('form.booking-form');
// Playwright tests a regex label against the label's raw textContent (not the trimmed accessible
// name), so leading whitespace from the markup is allowed; the label must still start with the
// field name.
const byLabelStart = (page, name) => page.getByLabel(new RegExp(`^\\s*${name}\\b`));
const field = {
  name: (page) => byLabelStart(page, 'Name'),
  phone: (page) => byLabelStart(page, 'Phone'),
  email: (page) => byLabelStart(page, 'Email'),
  date: (page) => byLabelStart(page, 'Date'),
  time: (page) => byLabelStart(page, 'Time'),
  party: (page) => byLabelStart(page, 'Party size'),
  notes: (page) => byLabelStart(page, 'Notes'),
};
const submit = (page) => page.getByRole('button', { name: 'Request a table' });
const statusPanel = (page) => page.locator('[role="status"]');

/** [value, text] of every option of a select. */
const optionsOf = (select) =>
  select.locator('option').evaluateAll((options) => options.map((o) => [o.value, o.textContent.trim()]));

/** "HH:MM" every 30 minutes from `from` to `to`, inclusive. */
function slotRange(from, to) {
  const minutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const out = [];
  for (let m = minutes(from); m <= minutes(to); m += 30) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  return out;
}

/** The ids in a field's aria-describedby that point at a visible, non-empty message. */
async function describedErrors(page, locator) {
  const ids = ((await locator.getAttribute('aria-describedby')) ?? '').split(/\s+/).filter(Boolean);
  const messages = [];
  for (const id of ids) {
    const el = page.locator(`[id="${id}"]`);
    if ((await el.count()) && (await el.isVisible()) && /error/.test(id)) messages.push((await el.innerText()).trim());
  }
  return messages.filter(Boolean);
}

async function fillValidRequest(page) {
  await field.name(page).fill('Ada Lovelace');
  await field.phone(page).fill('+1 555 0199');
  await field.date(page).fill('2026-06-21');
  await field.time(page).selectOption('19:00');
  await field.party(page).selectOption('4');
}

/** Records every request the page makes from now on. */
function recordRequests(page) {
  const requests = [];
  page.on('request', (req) =>
    requests.push({ method: req.method(), url: req.url(), body: req.method() === 'POST' ? req.postDataJSON() : null }),
  );
  return requests;
}

/* ------------------------------------------------------------------ colour helpers (WCAG 2.x) */

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

/** Text colour and effective background colour (nearest non-transparent ancestor) of an element. */
const colours = (locator) =>
  locator.evaluate((el) => {
    let bg = 'rgb(255, 255, 255)';
    for (let node = el; node; node = node.parentElement) {
      const color = getComputedStyle(node).backgroundColor;
      if (!/^rgba\(.*,\s*0\)$|^transparent$/.test(color)) {
        bg = color;
        break;
      }
    }
    return { color: getComputedStyle(el).color, bg };
  });

async function expectContrast(locator, label) {
  const { color, bg } = await colours(locator);
  const background = parseColor(bg);
  const ratio = contrastRatio(composite(parseColor(color), background), background);
  expect(ratio, `${label}: ${color} on ${bg}`).toBeGreaterThanOrEqual(4.5);
}

/* ================================================================== AC-1 */

test('AC-1: the build emits booking.html and the preview server serves it', async ({ page }) => {
  const config = (await import(pathToFileURL(path.join(ROOT, 'vite.config.js')).href)).default;
  const inputs = Object.values(config.build.rollupOptions.input).map((file) => path.relative(ROOT, file));
  expect(inputs.sort()).toEqual(['booking.html', 'index.html']);

  expect(existsSync(path.join(ROOT, 'dist/index.html'))).toBe(true);
  expect(existsSync(path.join(ROOT, 'dist/booking.html'))).toBe(true);

  const response = await page.goto('/booking.html');
  expect(response.status()).toBe(200);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveText('Book a table');
  await expect(page).toHaveTitle(/Book a table/);
});

/* ================================================================== AC-2 */

test('AC-2: booking.html shares the site shell and loads cleanly', async ({ page, baseURL }) => {
  await page.setViewportSize(DESKTOP);
  const origin = new URL(baseURL).origin;
  const problems = [];
  page.on('console', (msg) => msg.type() === 'error' && problems.push(`console: ${msg.text()}`));
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.protocol !== 'data:' && url.origin !== origin) problems.push(`foreign request: ${req.url()}`);
  });
  page.on('response', (res) => res.status() >= 400 && problems.push(`HTTP ${res.status()}: ${res.url()}`));

  await page.goto('/', { waitUntil: 'networkidle' });
  const homeHours = await page.locator('footer#contact .hours').innerText();

  await page.goto('/booking.html', { waitUntil: 'networkidle' });
  await expect(page.locator('header .site-nav')).toHaveCount(1);
  await expect(page.locator('main#main')).toHaveCount(1);
  await expect(page.locator('footer#contact')).toHaveCount(1);
  expect(await page.locator('footer#contact .hours').innerText()).toBe(homeHours);
  await expect(page.locator('footer#contact a[href="tel:+15550100"]')).toHaveCount(1);
  await expect(page.locator('a.skip-link')).toHaveAttribute('href', '#main');
  await expect(page.locator('header a.brand')).toHaveAttribute('href', '/#home');

  expect(problems).toEqual([]);
});

/* ================================================================== AC-3 */

test('AC-3: the home page nav ends with Book, which is never marked current', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto('/');
  await expect(navLink(page, 'Home')).toHaveAttribute('aria-current', 'true');
  const nav = await navState(page);
  expect(nav.map(({ name, href }) => [name, href])).toEqual([
    ['Home', '#home'],
    ['About', '#about'],
    ['Gallery', '#gallery'],
    ['Contact', '#contact'],
    ['Book', '/booking.html'],
  ]);
  expect(nav.find((link) => link.name === 'Book').current).toBeNull();
});

test('AC-3: booking.html links back to the home sections and marks Book as the current page', async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto('/booking.html');
  const nav = await navState(page);
  expect(nav.map(({ name, href }) => [name, href])).toEqual([
    ['Home', '/#home'],
    ['About', '/#about'],
    ['Gallery', '/#gallery'],
    ['Contact', '#contact'],
    ['Book', '/booking.html'],
  ]);
  expect(nav.filter((link) => link.current !== null)).toEqual([
    { name: 'Book', href: '/booking.html', current: 'page' },
  ]);

  // The current page looks current: brighter text and the underline drawn.
  const look = (name) =>
    navLink(page, name).evaluate((el) => {
      const after = getComputedStyle(el, '::after');
      const scaleX = after.transform === 'none' ? 1 : new DOMMatrixReadOnly(after.transform).a;
      return { color: getComputedStyle(el).color, underline: scaleX * parseFloat(after.width) };
    });
  await expect.poll(async () => (await look('Book')).underline).toBeGreaterThan(0);
  const book = await look('Book');
  const about = await look('About');
  expect(book.color).not.toBe(about.color);
  expect(about.underline).toBe(0);
});

/* ================================================================== AC-4 */

test('AC-4: scroll-spy never moves aria-current off Book on booking.html', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/booking.html');

  const current = async () => (await navState(page)).filter((link) => link.current !== null);
  const bookOnly = [{ name: 'Book', href: '/booking.html', current: 'page' }];
  expect(await current()).toEqual(bookOnly);

  // Footer in view (where "#contact" points).
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await waitForScrollEnd(page);
  await expect(page.locator('footer#contact')).toBeInViewport();
  expect(await current()).toEqual(bookOnly);

  // Following the in-page Contact link.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await navLink(page, 'Contact').click();
  await expect(page).toHaveURL(/#contact$/);
  await waitForScrollEnd(page);
  expect(await current()).toEqual(bookOnly);

  expect(errors).toEqual([]);
});

/* ================================================================== AC-5 */

test('AC-5: on booking.html the mobile menu closes on Contact and on growing to desktop', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.goto('/booking.html');
  const toggle = page.locator('header nav button');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  for (const name of ['Home', 'About', 'Gallery', 'Contact', 'Book']) {
    await expect(navLink(page, name)).toBeVisible();
  }
  await navLink(page, 'Contact').click();
  await expect(page).toHaveURL(/#contact$/);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(navLink(page, 'Contact')).toBeHidden();

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.setViewportSize(DESKTOP);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(navLink(page, 'Book')).toBeVisible();
});

test('AC-5: on the home page the brand link closes the mobile menu', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.goto('/');
  const toggle = page.locator('header nav button');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.locator('header a.brand').click();
  await expect(page).toHaveURL(/#home$/);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

/* ================================================================== AC-6 */

test('AC-6: Reserve a Table opens the booking page; the footer keeps the phone link', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('footer#contact a[href^="tel:"]')).not.toHaveCount(0);
  const reserve = page.locator('#home').getByRole('link', { name: 'Reserve a Table' });
  await expect(reserve).toHaveAttribute('href', '/booking.html');

  await reserve.click();
  await expect(page).toHaveURL(/\/booking\.html$/);
  await expect(page.locator('h1')).toHaveText('Book a table');
});

/* ================================================================== AC-7 … AC-13: the form */

test.describe('Booking form', () => {
  test.use({ timezoneId: TIME_ZONE });

  // The clock is fixed in June 2026, so the real API would reject these dates: mock it with a 201.
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/bookings', (route) =>
      route.fulfill({ status: 201, contentType: 'application/json', body: '{"id":1,"created_at":"2026-06-14T16:00:00.000Z"}' }),
    );
  });

  test('AC-7: every field has a visible label, required fields are marked, no form action', async ({ page }) => {
    await openBookingAt(page, SUNDAY_MORNING);
    await expect(form(page)).toHaveCount(1);
    expect(await form(page).evaluate((el) => el.hasAttribute('action'))).toBe(false);

    for (const [key, required] of [
      ['name', true],
      ['phone', true],
      ['email', false],
      ['date', true],
      ['time', true],
      ['party', true],
      ['notes', false],
    ]) {
      const input = field[key](page);
      await expect(input, key).toHaveCount(1);
      await expect(input, key).toBeVisible();
      const id = await input.getAttribute('id');
      const label = page.locator(`label[for="${id}"]`);
      await expect(label, `${key} label`).toBeVisible();
      await expect(input, `${key} required`).toHaveJSProperty('required', required);
      if (required) await expect(label, `${key} says required in words`).toContainText('(required)');
    }

    const party = field.party(page);
    expect(await party.evaluate((el) => el.tagName)).toBe('SELECT');
    expect((await optionsOf(party)).map(([value]) => value)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    await expect(party).toHaveValue('2');
    const hintId = await party.getAttribute('aria-describedby');
    await expect(page.locator(`[id="${hintId}"]`)).toContainText('For 9+ guests please call us');
    await expect(page.getByRole('button', { name: 'Request a table' })).toHaveAttribute('type', 'submit');
  });

  test('AC-8: date limits use the local date, not the UTC one', async ({ page }) => {
    await openBookingAt(page, SUNDAY_LATE);
    const date = field.date(page);
    await expect(date).toHaveAttribute('min', '2026-06-14');
    await expect(date).toHaveAttribute('max', '2026-08-13');

    await date.fill('2026-06-14');
    expect(await optionsOf(field.time(page))).toEqual([['', 'No times left today – choose another date']]);
  });

  test('AC-9: time slots follow the opening hours of the chosen day', async ({ page }) => {
    await openBookingAt(page, SUNDAY_MORNING);
    const time = field.time(page);
    expect(await optionsOf(time)).toEqual([['', 'Choose a date first']]);

    for (const [date, from, to, count] of [
      ['2026-06-21', '11:00', '20:00', 19], // Sunday
      ['2026-06-15', '12:00', '21:00', 19], // Monday
      ['2026-06-19', '12:00', '22:00', 21], // Friday
      ['2026-06-20', '12:00', '22:00', 21], // Saturday
    ]) {
      await field.date(page).fill(date);
      const options = await optionsOf(time);
      expect(options[0], date).toEqual(['', 'Choose a time']);
      const slots = options.slice(1);
      expect(slots.length, date).toBe(count);
      expect(slots, date).toEqual(slotRange(from, to).map((t) => [t, t]));
    }
  });

  test('AC-9: on today, times that have already started are left out', async ({ page }) => {
    await openBookingAt(page, SUNDAY_AFTERNOON);
    await field.date(page).fill('2026-06-14');
    const slots = (await optionsOf(field.time(page))).slice(1).map(([value]) => value);
    expect(slots).toEqual(slotRange('14:30', '20:00'));
  });

  test('AC-9: a chosen time is kept when the new date still offers it, otherwise reset', async ({ page }) => {
    await openBookingAt(page, SUNDAY_MORNING);
    const time = field.time(page);
    await field.date(page).fill('2026-06-19'); // Friday, last slot 22:00
    await time.selectOption('19:00');
    await field.date(page).fill('2026-06-21'); // Sunday still has 19:00
    await expect(time).toHaveValue('19:00');

    await field.date(page).fill('2026-06-19');
    await time.selectOption('22:00');
    await field.date(page).fill('2026-06-15'); // Monday ends at 21:00
    await expect(time).toHaveValue('');

    await field.date(page).fill('');
    expect(await optionsOf(time)).toEqual([['', 'Choose a date first']]);
  });

  test('AC-10: an empty submit explains each problem in words and focuses the first one', async ({ page }) => {
    await openBookingAt(page, SUNDAY_MORNING);
    const url = page.url();
    const requests = recordRequests(page);

    await submit(page).click();
    await expect(statusPanel(page)).toBeHidden();
    await expect(form(page)).toBeVisible();
    await expect(field.name(page)).toBeFocused();

    for (const key of ['name', 'phone', 'date', 'time']) {
      await expect(field[key](page), key).toHaveAttribute('aria-invalid', 'true');
      expect((await describedErrors(page, field[key](page))).length, `${key} message`).toBe(1);
    }
    for (const key of ['email', 'party', 'notes']) {
      await expect(field[key](page), key).not.toHaveAttribute('aria-invalid');
    }

    // Fixing a field clears its message straight away.
    await field.name(page).fill('Ada Lovelace');
    await expect(field.name(page)).not.toHaveAttribute('aria-invalid');
    expect(await describedErrors(page, field.name(page))).toEqual([]);
    await expect(page.locator('#booking-name-error')).toBeHidden();

    await submit(page).click();
    await expect(field.phone(page)).toBeFocused();

    // A phone number needs digits.
    await field.phone(page).fill('abc');
    await expect(field.phone(page)).toHaveAttribute('aria-invalid', 'true');
    expect((await describedErrors(page, field.phone(page)))[0]).toMatch(/digits/);
    await submit(page).click();
    await expect(field.phone(page)).toBeFocused();
    await expect(statusPanel(page)).toBeHidden();

    // A date chosen after the empty submit turns the time message into "choose a time".
    await field.date(page).fill('2026-06-21');
    await expect(field.date(page)).not.toHaveAttribute('aria-invalid');
    expect((await describedErrors(page, field.time(page)))[0]).toBe('Please choose a time.');

    expect(requests).toEqual([]);
    expect(page.url()).toBe(url);
  });

  test('AC-10: a name of only spaces and a date outside the window are rejected', async ({ page }) => {
    await openBookingAt(page, SUNDAY_MORNING);
    await fillValidRequest(page);
    await field.name(page).fill('   ');
    await field.date(page).fill('2026-08-14'); // one day past the 60-day window
    await submit(page).click();
    await expect(field.name(page)).toBeFocused();
    await expect(field.name(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(field.date(page)).toHaveAttribute('aria-invalid', 'true');
    expect((await describedErrors(page, field.date(page)))[0]).toMatch(/60 days/);
    await expect(statusPanel(page)).toBeHidden();
  });

  test('AC-11: a valid request shows an honest summary and sends exactly one POST to the API', async ({ page }) => {
    await openBookingAt(page, SUNDAY_MORNING);
    const url = page.url();
    const requests = recordRequests(page);

    await fillValidRequest(page);
    await submit(page).click();

    const panel = statusPanel(page);
    await expect(panel).toBeVisible();
    await expect(panel).toBeFocused();
    await expect(form(page)).toBeHidden();

    const text = await panel.innerText();
    for (const part of ['Ada Lovelace', '4', 'Sunday', '21', 'June', '19:00', 'saved', '+1 (555) 0100']) {
      expect(text, part).toContain(part);
    }
    expect(text).not.toMatch(/\b(booked|confirmed)\b/i);
    await expect(panel.locator('a[href="tel:+15550100"]')).toHaveCount(1);

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
    expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  });

  test('AC-11: the guest’s name is shown as text, never as markup', async ({ page }) => {
    await openBookingAt(page, SUNDAY_MORNING);
    await fillValidRequest(page);
    await field.name(page).fill('<img src=x onerror="window.__xss=1">');
    await submit(page).click();
    await expect(statusPanel(page)).toContainText('<img src=x onerror="window.__xss=1">');
    expect(await statusPanel(page).locator('img').count()).toBe(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });

  test('AC-12: Make another request brings the form back with the values kept', async ({ page }) => {
    await openBookingAt(page, SUNDAY_MORNING);
    await fillValidRequest(page);
    await submit(page).click();
    await expect(statusPanel(page)).toBeVisible();

    await page.getByRole('button', { name: 'Make another request' }).click();
    await expect(statusPanel(page)).toBeHidden();
    await expect(form(page)).toBeVisible();
    await expect(field.name(page)).toHaveValue('Ada Lovelace');
    await expect(field.time(page)).toHaveValue('19:00');
    await expect(field.party(page)).toHaveValue('4');
    await expect(field.name(page)).toBeFocused();
  });

  test('AC-13: no horizontal overflow at 320px, before and after submitting', async ({ page }) => {
    await page.setViewportSize(NARROW);
    await openBookingAt(page, SUNDAY_LATE);
    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);

    // The longest time placeholder and every inline error.
    await field.date(page).fill('2026-06-14');
    await submit(page).click();
    expect(await overflow()).toBeLessThanOrEqual(0);

    await field.name(page).fill('Ada Lovelace');
    await field.phone(page).fill('+1 555 0199');
    await field.date(page).fill('2026-06-21');
    await field.time(page).selectOption('19:00');
    await submit(page).click();
    await expect(statusPanel(page)).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
  });

  test('AC-13: page text, hints, errors and the summary have at least 4.5:1 contrast', async ({ page }) => {
    await openBookingAt(page, SUNDAY_MORNING);
    await expectContrast(page.locator('h1'), 'h1');
    await expectContrast(page.locator('label[for="booking-name"]'), 'field label');
    await expectContrast(page.locator('label[for="booking-name"] .field__flag'), '"(required)"');
    await expectContrast(page.locator('#booking-party-hint'), 'party-size hint');
    await expectContrast(page.locator('.booking__notice'), 'demo notice');

    await submit(page).click();
    const error = page.locator('#booking-name-error');
    await expect(error).toBeVisible();
    expect((await error.innerText()).trim()).not.toBe('');
    await expectContrast(error, 'inline error');

    await fillValidRequest(page);
    await submit(page).click();
    await expect(statusPanel(page)).toBeVisible();
    await expectContrast(statusPanel(page).locator('p').first(), 'summary text');
    await expectContrast(statusPanel(page).locator('dd').first(), 'summary details');
  });
});

/* ================================================================== AC-14 */

test('AC-14: README and package.json describe the multi-page site and its booking page and its SQLite storage', () => {
  const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

  expect(readme).not.toMatch(/single[- ]page/i);
  expect(pkg.description).not.toMatch(/single[- ]page/i);
  expect(readme).toMatch(/booking\.html|booking page/i);
  expect(readme).toMatch(/SQLite/);
  expect(readme).toMatch(/BOOKINGS_DB_PATH/);

  // No new dependencies of any kind.
  expect(pkg.dependencies).toBeUndefined();
  expect(Object.keys(pkg.devDependencies).sort()).toEqual(['@playwright/test', 'vite']);
});
