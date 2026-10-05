import { defineConfig, devices } from '@playwright/test';
import { config } from 'dotenv';
config({ path: '.env', quiet: true });
const webUrl = process.env.WEB_URL ?? 'http://localhost:3000';
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  expect: { timeout: 10000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: webUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run start -w @flowsync/api',
      url: `${apiUrl}/health/live`,
      timeout: 60000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run start -w @flowsync/web',
      url: `${webUrl}/login`,
      timeout: 60000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
