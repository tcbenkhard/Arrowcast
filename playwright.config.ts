import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    browserName: 'chromium',
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
  },
  webServer: [
    { command: 'node --import tsx tests/e2e/server.mts', url: 'http://127.0.0.1:3000/api/v1/admin/me',
      reuseExistingServer: false },
    { command: 'npm run dev --workspace=@arrowcast/web -- --host 127.0.0.1', url: 'http://127.0.0.1:5173',
      reuseExistingServer: false },
  ],
});
