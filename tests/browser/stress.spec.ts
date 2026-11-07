import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

test.describe('B2 浏览器压力测试', () => {
  test('2000 精灵 + 500 碰撞体 + HUD + 200 行列表', async ({ page }) => {
    // 启动压力页面
    await page.goto('http://localhost:4177/stress-fixture.html');

    // 等待初始化
    await page.waitForFunction(() => window.perfData && window.perfData.frameTimes.length > 0);

    console.log('压力测试页面已启动，开始采集...');

    // 运行 10 秒采集性能数据
    await page.waitForTimeout(10000);

    // 获取指标
    const metrics = await page.evaluate(() => window.getMetrics());

    console.log('采集完成，指标：', JSON.stringify(metrics, null, 2));

    // 验证基本运行
    expect(metrics.frameTimes.count).toBeGreaterThan(300); // 至少 30 fps × 10 秒
    expect(metrics.frameTimes.p50).toBeGreaterThan(0);
    expect(metrics.frameTimes.p95).toBeGreaterThan(0);

    // 写入报告
    const report = {
      scenario: '2000 sprites + 500 colliders + HUD + 200 rows',
      duration: '10 seconds',
      timestamp: new Date().toISOString(),
      browser: 'Chrome',
      platform: process.platform,
      metrics: {
        frameTimes: metrics.frameTimes,
        heap: metrics.heap,
        longTasks: metrics.longTasks,
        fps: metrics.fps
      },
      rawFrameTimes: await page.evaluate(() => window.perfData.frameTimes)
    };

    const outputPath = join(__dirname, '../../docs/performance/browser-stress-0.5.json');
    await writeFile(outputPath, JSON.stringify(report, null, 2));

    console.log(`报告已写入: ${outputPath}`);
    console.log(`帧耗时 p50: ${metrics.frameTimes.p50}ms, p95: ${metrics.frameTimes.p95}ms`);
    console.log(`平均堆: ${metrics.heap.avgMB}MB, 长任务: ${metrics.longTasks}`);
  });
});
