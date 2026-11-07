import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  testDir: here,
  testMatch: 'stress.spec.ts',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: `${here}test-results`,
  reporter: [
    ['list'],
    ['html', { outputFolder: `${here}report/html-stress`, open: 'never' }],
    ['json', { outputFile: `${here}report/stress-results.json` }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4177',
    headless: true,
    channel: 'chrome',
    viewport: { width: 1280, height: 800 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    locale: 'zh-CN',
  },
});
