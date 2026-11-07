import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const screenshots = resolve('tests/browser/screenshots');
const reportDir = resolve('tests/browser/report');

async function screenshot(page: Page, name: string): Promise<void> {
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: join(screenshots, name), fullPage: true });
}

async function instrument(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const scope = window as unknown as {
      __jccMetrics: {
        audioContexts: unknown[];
        audioStarts: number;
        gains: Array<{ gain: { value: number } }>;
        imageLoads: number;
        pageshowPersisted: boolean[];
      };
      AudioContext: typeof AudioContext;
      Image: typeof Image;
    };
    scope.__jccMetrics = {
      audioContexts: [],
      audioStarts: 0,
      gains: [],
      imageLoads: 0,
      pageshowPersisted: [],
    };
    const originalAudio = scope.AudioContext;
    if (originalAudio) {
      const patched = class extends originalAudio {
        constructor(...args: ConstructorParameters<typeof AudioContext>) {
          super(...args);
          scope.__jccMetrics.audioContexts.push(this);
        }
      };
      scope.AudioContext = patched as typeof AudioContext;
      const createSource = originalAudio.prototype.createBufferSource;
      originalAudio.prototype.createBufferSource = function (this: AudioContext) {
        const node = createSource.call(this);
        const start = node.start.bind(node);
        node.start = (...args: Parameters<AudioBufferSourceNode['start']>) => {
          scope.__jccMetrics.audioStarts += 1;
          return start(...args);
        };
        return node;
      };
      const createGain = originalAudio.prototype.createGain;
      originalAudio.prototype.createGain = function (this: AudioContext) {
        const node = createGain.call(this);
        scope.__jccMetrics.gains.push(node);
        return node;
      };
    }
    const OriginalImage = scope.Image;
    scope.Image = class extends OriginalImage {
      set src(value: string) {
        scope.__jccMetrics.imageLoads += 1;
        super.src = value;
      }
      get src(): string {
        return super.src;
      }
    } as typeof Image;
    addEventListener('pageshow', (event) => {
      scope.__jccMetrics.pageshowPersisted.push((event as PageTransitionEvent).persisted);
    });
  });
}

async function metrics(page: Page) {
  return page.evaluate(() => {
    const scope = window as unknown as {
      __jccMetrics: {
        audioContexts: AudioContext[];
        audioStarts: number;
        gains: Array<{ gain: { value: number } }>;
        imageLoads: number;
        pageshowPersisted: boolean[];
      };
    };
    const value = scope.__jccMetrics;
    return {
      audioContexts: value.audioContexts.length,
      audioStates: value.audioContexts.map((context) => context.state),
      audioStarts: value.audioStarts,
      gains: value.gains.map((node) => node.gain.value),
      imageLoads: value.imageLoads,
      pageshowPersisted: value.pageshowPersisted,
    };
  });
}

async function startGame(page: Page): Promise<void> {
  const startButton = page.locator('.start-panel button');
  await expect(startButton).toBeEnabled({ timeout: 15_000 });
  await startButton.click();
  await page.waitForTimeout(500);
}

async function simulateVisibility(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((isHidden) => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => isHidden,
    });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (isHidden ? 'hidden' : 'visible'),
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

test.describe('H02 输入、历史与触控', () => {
  test('中文组合输入、焦点与光标在设置保存和刷新后保持正确', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/#/settings');
    await expect(page.locator('.app-main h1')).toHaveText('设置');
    const input = page.locator('input[autocomplete="nickname"]');
    await input.focus();
    await input.evaluate((element, value) => {
      const field = element as HTMLInputElement;
      field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
      field.value = '镜川';
      field.dispatchEvent(
        new InputEvent('input', { bubbles: true, isComposing: true, data: '镜川' }),
      );
      field.value = value;
      field.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: value }));
      field.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
      field.setSelectionRange(2, 2);
    }, '验收玩家');
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('验收玩家');
    await page.keyboard.press('ArrowLeft');
    expect(await input.evaluate((element) => (element as HTMLInputElement).selectionStart)).toBe(1);
    await page.waitForTimeout(300);
    await expect(input).toHaveValue('验收玩家');
    expect(await input.evaluate((element) => (element as HTMLInputElement).selectionStart)).toBe(1);
    await page.getByRole('button', { name: '保存设置' }).click();
    await expect(page.locator('.settings-page .status')).toHaveText('已保存');
    await screenshot(page, '11-ime-settings.png');
    await page.reload();
    await expect(input).toHaveValue('验收玩家');
    expect(errors).toEqual([]);
  });

  test('浏览器前进后退与往返缓存恢复保持路由和页面状态', async ({ page }) => {
    await instrument(page);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await page.getByRole('link', { name: '关卡' }).click();
    await expect(page).toHaveURL(/#\/levels$/);
    await page.getByRole('link', { name: /第一关/ }).click();
    await expect(page).toHaveURL(/#\/play\/one$/);
    await expect(page.locator('.start-panel button')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/#\/levels$/);
    await expect(page.locator('.app-main h1')).toHaveText('选择关卡');
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('.app-main h1')).toHaveText('镜川初');
    await page.goForward();
    await expect(page).toHaveURL(/#\/levels$/);
    await expect(page.locator('.app-main h1')).toHaveText('选择关卡');
    await screenshot(page, '12-history-levels.png');

    await page.goto('/#/play/one');
    await expect(page.locator('.start-panel button')).toBeVisible();
    await page.goto('about:blank');
    await page.goBack();
    await expect(page.locator('.app-header')).toContainText('镜川初');
    await expect(page.locator('.start-panel button')).toBeVisible();
    const value = await metrics(page);
    await mkdir(reportDir, { recursive: true });
    await writeFile(
      join(reportDir, 'history.json'),
      JSON.stringify(
        {
          pageshowPersisted: value.pageshowPersisted,
          bfcacheApplied: value.pageshowPersisted.includes(true),
        },
        null,
        2,
      ) + '\n',
    );
    await screenshot(page, '13-bfcache-restored.png');
    expect(errors).toEqual([]);
  });

  test.describe('触控', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('触控进入关卡、开始与暂停 HUD', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto('/');
      await page.getByRole('link', { name: '关卡' }).tap();
      await expect(page.locator('.level-list li')).toHaveCount(3);
      await page.getByRole('link', { name: /第一关/ }).tap();
      const startButton = page.locator('.start-panel button');
      await expect(startButton).toBeEnabled({ timeout: 15_000 });
      await startButton.tap();
      await page.waitForTimeout(500);
      await page.locator('play-hud .icon-button').tap();
      await expect(page.locator('play-hud .pause-panel')).toBeVisible();
      await page.waitForTimeout(400);
      await screenshot(page, '14-mobile-touch-paused.png');
      expect(errors).toEqual([]);
    });
  });
});

test.describe('H03 音频、主题与重复进出', () => {
  test('首次点击解锁音频，静音在后台恢复后仍保留', async ({ page }) => {
    await instrument(page);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/#/settings');
    await page.locator('input[type="checkbox"]').check();
    await page.getByRole('button', { name: '保存设置' }).click();
    await expect(page.locator('.settings-page .status')).toHaveText('已保存');

    await page.goto('/#/play/one');
    await startGame(page);
    await page.waitForTimeout(1_500);
    let value = await metrics(page);
    expect(value.audioContexts).toBeGreaterThanOrEqual(1);
    expect(value.audioStates).toContain('running');
    expect(value.audioStarts).toBeGreaterThanOrEqual(1);
    expect(value.gains.length).toBeGreaterThan(0);
    expect(Math.max(...value.gains)).toBe(0);
    await screenshot(page, '15-audio-muted.png');

    await simulateVisibility(page, true);
    await expect(page.locator('play-hud .pause-panel')).toBeVisible();
    await page.waitForTimeout(300);
    const hidden = await metrics(page);
    await simulateVisibility(page, false);
    await expect(page.locator('play-hud .pause-panel')).toHaveCount(0);
    await page.waitForTimeout(600);
    value = await metrics(page);
    expect(value.audioContexts).toBe(1);
    expect(value.audioStarts).toBeGreaterThan(hidden.audioStarts);
    expect(Math.max(...value.gains)).toBe(0);
    await screenshot(page, '16-background-resumed.png');
    expect(errors).toEqual([]);
  });

  test('重复进出游玩页只保留一个 AudioContext 且移除旧 Canvas', async ({ page }) => {
    await instrument(page);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    for (let index = 0; index < 3; index++) {
      await page.goto('/#/play/one');
      await startGame(page);
      await page.waitForTimeout(250);
      await page.getByRole('link', { name: '关卡' }).click();
      await expect(page.locator('.app-main h1')).toHaveText('选择关卡');
      await expect(page.locator('game-canvas canvas')).toHaveCount(0);
    }
    const value = await metrics(page);
    expect(value.audioContexts).toBe(1);
    expect(value.imageLoads).toBeGreaterThanOrEqual(3);
    await page.goto('/#/play/one');
    await expect(page.locator('.start-panel button')).toBeEnabled({ timeout: 15_000 });
    await screenshot(page, '17-reentry.png');
    expect(errors).toEqual([]);
  });

  test('森林主题真实替换 Canvas 金币画面', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('http://127.0.0.1:4176/#/play/one');
    await startGame(page);
    await page.waitForTimeout(1_000);
    const forest = await page.evaluate(() => {
      const canvas = document.querySelector('game-canvas canvas') as HTMLCanvasElement | null;
      if (!canvas) return undefined;
      const context = canvas.getContext('2d');
      if (!context) return undefined;
      const ratio = canvas.width / 480;
      return [...context.getImageData(Math.round(352 * ratio), Math.round(92 * ratio), 1, 1).data];
    });
    expect(forest).toBeDefined();
    expect(forest![1]!).toBeGreaterThan(forest![0]!);
    await screenshot(page, '18-forest-play.png');

    await page.goto('http://127.0.0.1:4175/#/play/one');
    await startGame(page);
    await page.waitForTimeout(1_000);
    const standard = await page.evaluate(() => {
      const canvas = document.querySelector('game-canvas canvas') as HTMLCanvasElement | null;
      if (!canvas) return undefined;
      const context = canvas.getContext('2d');
      if (!context) return undefined;
      const ratio = canvas.width / 480;
      return [...context.getImageData(Math.round(352 * ratio), Math.round(92 * ratio), 1, 1).data];
    });
    expect(standard).toBeDefined();
    expect(standard![0]!).toBeGreaterThan(standard![1]!);
    expect(errors).toEqual([]);
  });
});

test.describe('H04 性能测量', () => {
  test('记录构建体积、游戏帧耗时与重复进出内存', async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const sizeOf = async (directory: string): Promise<number> => {
      let total = 0;
      const files = (await readdir(directory, { recursive: true })) as string[];
      for (const file of files) {
        const info = await stat(join(directory, file));
        if (info.isFile()) total += info.size;
      }
      return total;
    };
    const sizes = {
      defaultBytes: await sizeOf(resolve('templates/browser/dist')),
      forestBytes: await sizeOf(resolve('tests/browser/artifacts/forest-dist')),
    };

    await page.goto('/#/play/one');
    await startGame(page);
    const frames = await page.evaluate(
      () =>
        new Promise<{ count: number; average: number; p95: number; min: number; max: number }>(
          (resolve) => {
            const deltas: number[] = [];
            let previous: number | undefined;
            const start = performance.now();
            const frame = (time: number): void => {
              if (previous !== undefined) deltas.push(time - previous);
              previous = time;
              if (time - start >= 3_000) {
                const sorted = [...deltas].sort((a, b) => a - b);
                resolve({
                  count: deltas.length,
                  average:
                    deltas.reduce((sum, value) => sum + value, 0) / Math.max(1, deltas.length),
                  p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
                  min: sorted[0] ?? 0,
                  max: sorted.at(-1) ?? 0,
                });
                return;
              }
              requestAnimationFrame(frame);
            };
            requestAnimationFrame(frame);
          },
        ),
    );
    expect(frames.count).toBeGreaterThan(0);
    expect(frames.average).toBeLessThan(200);
    await screenshot(page, '19-performance-play.png');

    const session = await page.context().newCDPSession(page);
    await session.send('Performance.enable');
    const heap = async (): Promise<number> => {
      const result = (await session.send('Performance.getMetrics')) as {
        metrics: Array<{ name: string; value: number }>;
      };
      return result.metrics.find((item) => item.name === 'JSHeapUsedSize')?.value ?? 0;
    };
    const before = await heap();
    for (let index = 0; index < 3; index++) {
      await page.goto('/#/levels');
      await page.goto('/#/play/one');
      await startGame(page);
    }
    const after = await heap();
    expect(before).toBeGreaterThan(0);
    expect(after).toBeGreaterThan(0);

    await mkdir(reportDir, { recursive: true });
    await writeFile(
      join(reportDir, 'metrics.json'),
      JSON.stringify(
        {
          measuredAt: new Date().toISOString(),
          browser: 'Google Chrome via Playwright',
          build: {
            defaultBytes: sizes.defaultBytes,
            forestBytes: sizes.forestBytes,
            defaultMiB: Number((sizes.defaultBytes / 1024 / 1024).toFixed(2)),
            forestMiB: Number((sizes.forestBytes / 1024 / 1024).toFixed(2)),
          },
          frames,
          heap: {
            beforeBytes: before,
            afterBytes: after,
            deltaBytes: after - before,
            beforeMiB: Number((before / 1024 / 1024).toFixed(2)),
            afterMiB: Number((after / 1024 / 1024).toFixed(2)),
          },
          scale: {
            levelOneEntities: 6,
            note: '第一关 1 个玩家 + 5 枚金币；未做大规模实体压力场景。',
          },
        },
        null,
        2,
      ) + '\n',
    );
    expect(errors).toEqual([]);
  });
});
