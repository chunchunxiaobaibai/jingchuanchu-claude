import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  testDir: here,
  testMatch: '*.spec.ts',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: `${here}test-results`,
  reporter: [
    ['list'],
    ['html', { outputFolder: `${here}report/html`, open: 'never' }],
    ['json', { outputFile: `${here}report/results.json` }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4175',
    headless: true,
    channel: 'chrome',
    viewport: { width: 1280, height: 800 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    locale: 'zh-CN',
  },
  webServer: [
    {
      command: 'npx vite preview templates/browser --host 127.0.0.1 --port 4175 --strictPort',
      cwd: process.cwd(),
      url: 'http://127.0.0.1:4175',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'node tests/browser/serve.mjs tests/browser/artifacts/forest-dist 4176',
      cwd: process.cwd(),
      url: 'http://127.0.0.1:4176',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'node tests/browser/serve.mjs tests/browser 4177',
      cwd: process.cwd(),
      url: 'http://127.0.0.1:4177',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
