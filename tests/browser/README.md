# 浏览器验收测试

使用 Playwright 驱动本机 Google Chrome 验证参考游戏。默认 headless，测试产物（截图、报告、性能数据）保留在本目录，供后续人工介入。

## 运行

```bash
npm run test:browser
```

该命令依次执行：

1. `npm run build:packages`：重建引擎包 `dist`，避免浏览器加载旧运行时。
2. `npm run build:browser`：构建默认主题产物 `templates/browser/dist`。
3. `npm run build:browser:forest`：构建森林主题产物 `tests/browser/artifacts/forest-dist`。
4. `playwright test -c tests/browser/playwright.config.ts`。

单独运行（已构建产物时）：

```bash
npx playwright test -c tests/browser/playwright.config.ts
```

仅运行 H02–H04：

```bash
npx playwright test -c tests/browser/playwright.config.ts advanced-acceptance.spec.ts
```

需要本机安装 Chrome（Playwright 配置使用 `channel: "chrome"`）。未下载 Playwright 自带 Chromium 也能运行。

## 端口

- `4175`：默认主题，由 `vite preview templates/browser` 提供。
- `4176`：森林主题，由 `tests/browser/serve.mjs` 提供 `tests/browser/artifacts/forest-dist`。

配置使用 `reuseExistingServer: true`；若端口被旧进程占用，先停止旧进程。

## 用例

- `reference-game.spec.ts`：首页、关卡、游玩、收集、暂停/继续、重开、设置持久化、倒计时结算、移动端布局。
- `advanced-acceptance.spec.ts`：
  - H02：组合输入/焦点/光标、前进后退、往返缓存尝试、触控 HUD。
  - H03：音频解锁、静音保持、visibility 后台暂停恢复、重复进出资源、森林主题 Canvas 像素。
  - H04：构建体积、3 秒帧耗时、重复进出 JS heap、当前关卡实体规模。

## 产物

- `screenshots/`：实际浏览器截图（01–19）。
- `report/report.md`：人工可读报告。
- `report/html/`：Playwright HTML 报告。
- `report/results.json`：机器结果。
- `report/history.json`：`pageshow.persisted` 与 bfcache 判定。
- `report/metrics.json`：构建体积、帧耗时、内存和规模数据。
- `artifacts/`：森林主题构建产物（已加入 `.gitignore`，可重新生成）。

## 仍需人工验收

- 操作系统中文输入法候选窗、组合期间光标/焦点。
- 真实触控设备坐标与手势（参考游戏当前为键盘移动，Canvas 触控坐标仅由 Node 注入几何测试覆盖）。
- 自动化 Chrome 未进入 bfcache（`pageshow.persisted=false`），真实浏览器往返缓存需人工确认。
- 真实音频听感、手机后台/锁屏恢复。
- 真机屏幕安全区、软键盘、Firefox/Safari。
- 大规模实体、长时间运行和多设备性能；当前数据仅代表参考关卡 6 个实体。

人工验收时请记录浏览器版本、设备/系统、复现步骤，并将结果补入 `report/report.md` 或另建记录。
