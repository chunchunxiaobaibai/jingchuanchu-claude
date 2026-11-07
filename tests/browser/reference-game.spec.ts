import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const screenshots = resolve('tests/browser/screenshots');

async function screenshot(page: Page, name: string): Promise<void> {
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: join(screenshots, name), fullPage: true });
}

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test('首页与关卡选择呈现参考游戏内容', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto('/');
  await expect(page.locator('.app-header')).toContainText('镜川初');
  await expect(page.locator('.app-main h1')).toHaveText('镜川初');
  await expect(page.locator('.app-header .best')).toContainText('最高分');
  await screenshot(page, '01-home.png');

  await page.getByRole('link', { name: '关卡' }).click();
  await expect(page).toHaveURL(/#\/levels$/);
  await expect(page.locator('.app-main h1')).toHaveText('选择关卡');
  await expect(page.locator('.level-list li')).toHaveCount(3);
  await expect(page.locator('.level-list li').first()).toContainText('第一关 · 河岸');
  await expect(page.locator('.level-list li').nth(1)).toContainText('未解锁');
  await expect(page.locator('.level-list li').nth(1).getByRole('link')).toHaveAttribute(
    'href',
    '#/levels',
  );
  await screenshot(page, '02-levels.png');
  expect(errors).toEqual([]);
});

test('游玩页开始、移动收集、暂停恢复与重开', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = collectPageErrors(page);
  await page.goto('/#/play/one');
  const startButton = page.locator('.start-panel button');
  await expect(startButton).toBeVisible();
  await expect(startButton).toBeEnabled({ timeout: 15_000 });
  await screenshot(page, '03-play-start.png');

  await startButton.click();
  await expect(page.locator('play-hud .stats')).toContainText('得分');
  await expect(page.locator('play-hud .stats')).toContainText('时间');
  await page.waitForTimeout(500);
  await screenshot(page, '04-play-gameplay.png');

  await page.keyboard.down('ArrowUp');
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(360);
  await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(620);
  await page.keyboard.up('ArrowRight');
  await expect(page.locator('play-hud .stats')).toContainText('得分 10', { timeout: 5_000 });
  await screenshot(page, '05-play-collected.png');

  await page.locator('play-hud .icon-button').click();
  await expect(page.locator('play-hud .pause-panel')).toBeVisible();
  await screenshot(page, '06-play-paused.png');
  await page.locator('play-hud .pause-panel button').first().click();
  await expect(page.locator('play-hud .pause-panel')).toHaveCount(0);

  await page.locator('play-hud .actions .text').click();
  await expect(page.locator('play-hud .stats')).toContainText('得分 0', { timeout: 5_000 });
  expect(errors).toEqual([]);
});

test('设置页保存昵称、音量与静音并在刷新后恢复', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto('/#/settings');
  await expect(page.locator('.app-main h1')).toHaveText('设置');
  const nickname = page.locator('input[autocomplete="nickname"]');
  await nickname.fill('验收玩家');
  await page.locator('input[type="range"]').fill('0.4');
  await page.locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(page.locator('.settings-page .status')).toHaveText('已保存');
  await screenshot(page, '07-settings.png');
  await page.reload();
  await expect(nickname).toHaveValue('验收玩家');
  await expect(page.locator('input[type="range"]')).toHaveValue('0.4');
  await expect(page.locator('input[type="checkbox"]')).toBeChecked();
  expect(errors).toEqual([]);
});

test('倒计时结束进入结算页并显示本局与最高分', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectPageErrors(page);
  await page.goto('/#/play/one');
  const startButton = page.locator('.start-panel button');
  await expect(startButton).toBeEnabled({ timeout: 15_000 });
  await startButton.click();
  await page.waitForURL(/#\/result$/, { timeout: 60_000 });
  await expect(page.locator('result-page h1, .app-main h1')).toContainText('第一关');
  await expect(page.locator('result-page .score, .app-main .score')).toContainText('本局得分');
  await expect(page.locator('result-page .score, .app-main .score')).toContainText('历史最高');
  await screenshot(page, '08-result.png');
  await page.getByRole('button', { name: '重玩本关' }).click();
  await expect(page).toHaveURL(/#\/play\/one$/);
  await expect(page.locator('.start-panel button')).toBeVisible();
  await screenshot(page, '10-result-replay.png');
  expect(errors).toEqual([]);
});

test.describe('移动端视口', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('首页在窄屏下不产生横向滚动', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/');
    await expect(page.locator('.app-main h1')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await screenshot(page, '09-mobile-home.png');
    expect(errors).toEqual([]);
  });
});
