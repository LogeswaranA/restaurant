// Submit flow of the booking form (prd AC-8, AC-9, AC-10): the real API + SQLite end to end, and
// the failure / in-flight behaviour with routed responses. No clock is faked here: the real API
// applies the date rules against the real date, so dates are relative to today.
import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_DB = process.env.BOOKINGS_TEST_DB_PATH ?? path.join(ROOT, 'test-results/bookings-test.db');
const SAVE_FAILED = 'Could not save your booking, please try again';

const pad = (n) => String(n).padStart(2, '0');
function dateInDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

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
const panel = (page) => page.locator('[role="status"]');
const submitError = (page) => page.locator('#booking-submit-error');

const DATE = dateInDays(7);
async function fillValid(page, name = 'Ada Lovelace') {
  await field.name(page).fill(name);
  await field.phone(page).fill('+1 555 0199');
  await field.email(page).fill('ada@example.com');
  await field.date(page).fill(DATE);
  await field.time(page).selectOption('19:00');
  await field.party(page).selectOption('4');
  await field.notes(page).fill('Window table please');
}

async function expectFormKept(page, name) {
  await expect(field.name(page)).toHaveValue(name);
  await expect(field.phone(page)).toHaveValue('+1 555 0199');
  await expect(field.email(page)).toHaveValue('ada@example.com');
  await expect(field.date(page)).toHaveValue(DATE);
  await expect(field.time(page)).toHaveValue('19:00');
  await expect(field.party(page)).toHaveValue('4');
  await expect(field.notes(page)).toHaveValue('Window table please');
}

test.describe('Booking submit flow', () => {
  test('AC-8: a valid submit goes through the real API, is stored in SQLite and then shows the summary', async ({ page }) => {
    const name = `E2E ${randomUUID()}`;
    await page.goto('/booking.html');
    const posts = [];
    page.on('request', (r) => r.method() === 'POST' && posts.push(new URL(r.url()).pathname));
    await fillValid(page, name);

    const [response] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname === '/api/bookings' && r.request().method() === 'POST'),
      submit(page).click(),
    ]);
    expect(response.status()).toBe(201);
    await expect(panel(page)).toBeVisible();
    // Note: response.json()/body() hangs for this proxied response in Playwright (the UI itself reads
    // it fine), so the row is found by its unique name instead of by the returned id.

    await expect(panel(page)).toContainText(name);
    await expect(panel(page)).toContainText('saved');
    await expect(form(page)).toBeHidden();
    expect(posts).toEqual(['/api/bookings']);

    const db = new DatabaseSync(TEST_DB);
    try {
      db.exec('PRAGMA busy_timeout = 5000');
      const rows = db.prepare('SELECT * FROM bookings WHERE name = ?').all(name);
      expect(rows).toHaveLength(1);
      const { id, created_at } = rows[0];
      expect(Number.isInteger(id)).toBe(true);
      expect(new Date(created_at).toISOString()).toBe(created_at);
      expect({ ...rows[0] }).toEqual({
        id,
        created_at,
        name,
        phone: '+1 555 0199',
        email: 'ada@example.com',
        date: DATE,
        time: '19:00',
        party: 4,
        notes: 'Window table please',
      });
    } finally {
      db.close();
    }
  });

  test('AC-8: an invalid form sends no request', async ({ page }) => {
    await page.goto('/booking.html');
    const posts = [];
    page.on('request', (r) => r.method() === 'POST' && posts.push(r.url()));
    await submit(page).click();
    await expect(field.name(page)).toBeFocused();
    await expect(panel(page)).toBeHidden();
    expect(posts).toEqual([]);
  });

  for (const [label, handler] of [
    ['a network error', (route) => route.abort('failed')],
    ['a 500', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"internal"}' })],
    ['a 503', (route) => route.fulfill({ status: 503, contentType: 'text/plain', body: 'unavailable' })],
  ]) {
    test(`AC-9: ${label} shows the failure message, no summary, values kept and the button re-enabled`, async ({ page }) => {
      await page.route('**/api/bookings', handler);
      await page.goto('/booking.html');
      await fillValid(page);
      await submit(page).click();

      await expect(submitError(page)).toBeVisible();
      await expect(submitError(page)).toHaveText(SAVE_FAILED);
      await expect(panel(page)).toBeHidden();
      await expect(form(page)).toBeVisible();
      await expectFormKept(page, 'Ada Lovelace');
      await expect(submit(page)).toBeEnabled();
    });
  }

  test('AC-9: a 400 shows which details were refused and keeps the form', async ({ page }) => {
    await page.route('**/api/bookings', (route) =>
      route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"invalid_booking","fields":["date"]}' }),
    );
    await page.goto('/booking.html');
    await fillValid(page);
    await submit(page).click();

    await expect(submitError(page)).toBeVisible();
    await expect(submitError(page)).toContainText('Date');
    await expect(panel(page)).toBeHidden();
    await expect(form(page)).toBeVisible();
    await expectFormKept(page, 'Ada Lovelace');
    await expect(submit(page)).toBeEnabled();
  });

  test('AC-10: the button is disabled while the request is in flight and enabled again afterwards', async ({ page }) => {
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    let seen = 0;
    await page.route('**/api/bookings', async (route) => {
      seen += 1;
      await gate;
      await route.fulfill({ status: 503, contentType: 'text/plain', body: 'unavailable' });
    });
    await page.goto('/booking.html');
    await fillValid(page);
    await submit(page).click();

    await expect(submit(page)).toBeDisabled();
    await expect.poll(() => seen).toBe(1);
    release();
    await expect(submitError(page)).toHaveText(SAVE_FAILED);
    await expect(submit(page)).toBeEnabled();
  });

  test('AC-10: a double click sends only one POST', async ({ page }) => {
    let posts = 0;
    await page.route('**/api/bookings', async (route) => {
      posts += 1;
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({ status: 201, contentType: 'application/json', body: '{"id":1,"created_at":"2026-01-01T00:00:00.000Z"}' });
    });
    await page.goto('/booking.html');
    await fillValid(page);
    await submit(page).dblclick();
    await expect(panel(page)).toBeVisible();
    await page.waitForTimeout(300);
    expect(posts).toBe(1);
  });
});

function form(page) {
  return page.locator('form.booking-form');
}
