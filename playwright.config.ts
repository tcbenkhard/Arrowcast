import { defineConfig } from '@playwright/test';

const apiPort = Number(process.env.ARROWCAST_E2E_API_PORT ?? 3000);
const webPort = Number(process.env.ARROWCAST_E2E_WEB_PORT ?? 5173);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    browserName: 'chromium',
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
  },
  webServer: [
    { command: 'node --import tsx tests/e2e/server.mts', url: `http://127.0.0.1:${apiPort}/api/v1/admin/me`,
      reuseExistingServer: false },
    { command: `npm run dev --workspace=@arrowcast/web -- --host 127.0.0.1 --port ${webPort}`, url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: false },
  ],
});
