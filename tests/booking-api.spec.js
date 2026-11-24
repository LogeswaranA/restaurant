import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDbPath, DEFAULT_DB_PATH } from '../server/db.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// BOOKINGS_TEST_DB_PATH is set by playwright.config.js: a per-run file in os.tmpdir(), off the checkout
// because file locking on some mounts is unreliable. The fallback only matters outside Playwright.
const DB_FILE = process.env.BOOKINGS_TEST_DB_PATH ?? path.join(ROOT, 'test-results/bookings-test.db');
const LEAK = /at |\.js|SELECT|INSERT|sqlite/i;

const html = readFileSync(path.join(ROOT, 'booking.html'), 'utf8');
function maxlength(id) {
  const tag = new RegExp(`<(?:input|textarea)[^>]*id="booking-${id}"[^>]*>`).exec(html)?.[0] ?? '';
  const m = /maxlength="(\d+)"/.exec(tag);
  if (!m) throw new Error(`no maxlength for ${id}`);
  return Number(m[1]);
}
const LIMITS = { name: maxlength('name'), phone: maxlength('phone'), email: maxlength('email'), notes: maxlength('notes') };

function query(sql, ...params) {
  const db = new DatabaseSync(DB_FILE);
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    return db.prepare(sql).all(...params);
  } finally {
    db.close();
  }
}
const byId = (id) => query('SELECT * FROM bookings WHERE id = ?', id);
const countBy = (col, value) => query(`SELECT COUNT(*) AS n FROM bookings WHERE ${col} = ?`, value)[0].n;

let seq = 0;
const unique = (testInfo) => `tok-${testInfo.workerIndex}-${Date.now()}-${seq++}`;

const pad = (n) => String(n).padStart(2, '0');
function dayOffset(n) {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** First date from tomorrow on, within 60 days, with the given weekday (0 = Sunday). */
function nextWeekday(day) {
  for (let n = 1; n <= 60; n++) if (dayOffset(n).getDay() === day) return fmt(dayOffset(n));
  throw new Error('unreachable');
}

function valid(token, extra = {}) {
  return {
    name: `Test ${token}`,
    phone: '+44 20 7946 0958',
    email: 'guest@example.com',
    date: fmt(dayOffset(7)),
    time: dayOffset(7).getDay() === 0 ? '12:00' : '19:00',
    party: 4,
    notes: token,
    ...extra,
  };
}
const post = (request, data) => request.post('/api/bookings', { data });

test.describe('POST /api/bookings', () => {
  test('AC-1: 201 with {id, created_at} and a row matching every column', async ({ request }, testInfo) => {
    const token = unique(testInfo);
    const body = valid(token);
    const res = await post(request, body);
    expect(res.status()).toBe(201);
    const json = await res.json();
    expect(typeof json.id).toBe('number');
    expect(Number.isNaN(Date.parse(json.created_at))).toBe(false);
    const rows = byId(json.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: json.id, created_at: json.created_at, ...body });
  });

  test('AC-2: missing or empty email and notes are stored as NULL', async ({ request }, testInfo) => {
    const token = unique(testInfo);
    const omitted = valid(token);
    delete omitted.email;
    delete omitted.notes;
    const r1 = await post(request, omitted);
    expect(r1.status()).toBe(201);
    const empty = valid(token, { email: '', notes: '   ' });
    const r2 = await post(request, empty);
    expect(r2.status()).toBe(201);
    for (const res of [r1, r2]) {
      const [row] = byId((await res.json()).id);
      expect(row.email).toBeNull();
      expect(row.notes).toBeNull();
    }
  });

  for (const field of ['name', 'phone', 'date', 'time', 'party']) {
    for (const mode of ['missing', 'blank']) {
      test(`AC-3: ${mode} ${field} gives 400 naming it and stores nothing`, async ({ request }, testInfo) => {
        const token = unique(testInfo);
        const body = valid(token);
        if (mode === 'missing') delete body[field];
        else body[field] = '';
        const res = await post(request, body);
        expect(res.status()).toBe(400);
        const json = await res.json();
        expect(json.fields).toContain(field);
        expect(JSON.stringify(json)).not.toMatch(LEAK);
        expect(countBy('notes', token)).toBe(0);
      });
    }
  }

  for (const field of ['name', 'phone', 'email', 'notes']) {
    test(`AC-3: ${field} at maxlength is accepted, maxlength+1 gives 400`, async ({ request }, testInfo) => {
      const limit = LIMITS[field];
      const make = (len) => {
        if (field === 'phone') return '1'.repeat(len);
        if (field === 'email') return 'a'.repeat(len - '@x.com'.length) + '@x.com';
        return 'x'.repeat(len);
      };
      const token = unique(testInfo);
      // The token goes into the name (or notes when name is the field under test) to find rows.
      const marker = field === 'name' ? { notes: token } : { name: token };

      const over = await post(request, valid(token, { ...marker, [field]: make(limit + 1) }));
      expect(over.status()).toBe(400);
      expect((await over.json()).fields).toContain(field);
      expect(countBy(field === 'name' ? 'notes' : 'name', token)).toBe(0);

      const exact = await post(request, valid(token, { ...marker, [field]: make(limit) }));
      expect(exact.status()).toBe(201);
      const [row] = byId((await exact.json()).id);
      expect(row[field]).toBe(make(limit));
    });
  }

  test('AC-4: past, too far ahead and malformed dates fail on date; today+60 is accepted', async ({ request }, testInfo) => {
    for (const date of [fmt(dayOffset(-1)), fmt(dayOffset(61)), '2026-02-30', 'abc']) {
      const token = unique(testInfo);
      const res = await post(request, valid(token, { date }));
      expect(res.status(), date).toBe(400);
      expect((await res.json()).fields).toContain('date');
      expect(countBy('notes', token)).toBe(0);
    }
    const d = dayOffset(60);
    const token = unique(testInfo);
    const ok = await post(request, valid(token, { date: fmt(d), time: d.getDay() === 0 ? '12:00' : '19:00' }));
    expect(ok.status()).toBe(201);
  });

  test('AC-5: closing-time and off-step times fail; valid slots pass', async ({ request }, testInfo) => {
    const sunday = nextWeekday(0);
    const friday = nextWeekday(5);
    const saturday = nextWeekday(6);
    for (const [date, time] of [
      [sunday, '20:30'],
      [sunday, '19:15'],
      [friday, '22:30'],
    ]) {
      const token = unique(testInfo);
      const res = await post(request, valid(token, { date, time }));
      expect(res.status(), `${date} ${time}`).toBe(400);
      expect((await res.json()).fields).toContain('time');
      expect(countBy('notes', token)).toBe(0);
    }
    for (const [date, time] of [
      [sunday, '11:00'],
      [friday, '22:00'],
      [saturday, '22:00'],
    ]) {
      const res = await post(request, valid(unique(testInfo), { date, time }));
      expect(res.status(), `${date} ${time}`).toBe(201);
    }
  });

  test('AC-6: party sizes', async ({ request }, testInfo) => {
    for (const party of [0, 9, 4.5, 'abc', '4']) {
      const token = unique(testInfo);
      const res = await post(request, valid(token, { party }));
      expect(res.status(), String(party)).toBe(400);
      expect((await res.json()).fields).toContain('party');
      expect(countBy('notes', token)).toBe(0);
    }
    for (const party of [1, 8]) {
      const res = await post(request, valid(unique(testInfo), { party }));
      expect(res.status(), String(party)).toBe(201);
    }
  });

  test('AC-7: SQL-looking text is stored verbatim and inserts still work', async ({ request }, testInfo) => {
    const token = unique(testInfo);
    const evil = `'); DROP TABLE bookings;--`;
    const res = await post(request, valid(token, { name: evil, notes: evil + token }));
    expect(res.status()).toBe(201);
    const [row] = byId((await res.json()).id);
    expect(row.name).toBe(evil);
    expect(row.notes).toBe(evil + token);
    const again = await post(request, valid(unique(testInfo)));
    expect(again.status()).toBe(201);
  });

  test('AC-7: malformed JSON, wrong content type, huge body and unknown route give safe errors', async ({ request }) => {
    const bad = await request.post('/api/bookings', {
      headers: { 'Content-Type': 'application/json' },
      data: Buffer.from('{"name": '),
    });
    expect(bad.status()).toBe(400);
    const badText = await bad.text();
    expect(JSON.parse(badText).error).toBe('invalid_json');
    expect(badText).not.toMatch(LEAK);

    const wrongType = await request.post('/api/bookings', {
      headers: { 'Content-Type': 'text/plain' },
      data: 'hello',
    });
    expect(wrongType.status()).toBe(415);
    expect(await wrongType.text()).not.toMatch(LEAK);

    const big = await request.post('/api/bookings', {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ notes: 'x'.repeat(40_000) }),
    });
    expect(big.status()).toBe(413);
    expect(await big.text()).not.toMatch(LEAK);

    const missing = await request.get('/api/nope');
    expect(missing.status()).toBe(404);
    expect(await missing.text()).not.toMatch(LEAK);
  });
});

test.describe('other routes and configuration', () => {
  test('AC-11: health returns 200 {status:"ok"}', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  test('AC-11: GET, PUT and DELETE on /api/bookings are not available', async ({ request }) => {
    for (const method of ['get', 'put', 'delete']) {
      const res = await request[method]('/api/bookings');
      expect([404, 405], method).toContain(res.status());
      expect(await res.text()).not.toMatch(/guest@example\.com/);
    }
  });

  test('AC-11: resolveDbPath defaults to data/bookings.db and honours BOOKINGS_DB_PATH', () => {
    expect(resolveDbPath({})).toBe(path.join(ROOT, 'data', 'bookings.db'));
    expect(resolveDbPath({ BOOKINGS_DB_PATH: '  ' })).toBe(DEFAULT_DB_PATH);
    expect(resolveDbPath({ BOOKINGS_DB_PATH: '/tmp/x/y.db' })).toBe(path.resolve('/tmp/x/y.db'));
    expect(resolveDbPath({ BOOKINGS_DB_PATH: 'rel/z.db' })).toBe(path.resolve('rel/z.db'));
  });

  test('AC-11: .gitignore covers data/ and *.db', () => {
    const lines = readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim());
    expect(lines).toContain('data/');
    expect(lines).toContain('*.db');
    // exit code 0 means every path is ignored for `git check-ignore` with multiple paths
    expect(() =>
      execFileSync('git', ['check-ignore', 'data/bookings.db', 'x.db'], { cwd: ROOT, stdio: 'pipe' }),
    ).not.toThrow();
  });

  test('AC-12: package.json engines.node is >=22.13 and has no runtime dependencies', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.engines.node).toBe('>=22.13');
    expect(pkg.dependencies ?? {}).toEqual({});
  });
});
