import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  use: { baseURL: 'http://localhost:4173' },
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
