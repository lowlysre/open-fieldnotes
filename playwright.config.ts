import { defineConfig, devices } from '@playwright/test';
import fieldnotesConfig from './fieldnotes.config.json' with { type: 'json' };

// Strip trailing slash so we can append it consistently below.
const base = fieldnotesConfig.base.replace(/\/$/, '');
const devUrl = `http://127.0.0.1:4321${base}/`;

export default defineConfig({
  testDir: './tests',
  testMatch: ['a11y.spec.ts'],
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: devUrl,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npx astro dev --host 127.0.0.1 --port 4321',
    url: devUrl,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
