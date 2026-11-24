import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 4173;

// Test DB: a fresh per-run file in os.tmpdir(), kept off the checkout because SQLite file locking is
// unreliable on some mounts (e.g. Docker bind mounts). Workers re-evaluate this config but inherit the
// runner's env, so they keep the same path. Tests never assert global row counts.
if (!process.env.BOOKINGS_TEST_DB_PATH) {
  const file = path.join(os.tmpdir(), `saffron-bookings-test-${Date.now()}-${process.pid}.db`);
  for (const suffix of ['', '-journal', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true });
  process.env.BOOKINGS_TEST_DB_PATH = file;
}

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'node --disable-warning=ExperimentalWarning server/index.js',
      url: 'http://127.0.0.1:8787/api/health',
      env: { BOOKINGS_DB_PATH: process.env.BOOKINGS_TEST_DB_PATH, PORT: '8787' },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      // Tests run against the production build, exactly as it would be deployed.
      command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
