# 参考游戏浏览器验收报告

- 日期：2026-10-17
- 被测对象：`templates/browser` 参考游戏（application profile，Vite 生产构建）
- 浏览器：Google Chrome 155.0.8059.80（Playwright `channel: "chrome"`，headless）
- Playwright：1.64.0
- 服务：`vite preview templates/browser`，`http://127.0.0.1:4175`
- 视口：桌面 1280×800；移动端 390×844
- 结果：**12 / 12 通过，0 失败**
- 命令：`npm run test:browser`（自动构建包、默认与森林主题产物）

## 用例结果

| #   | 用例           | 实际验证内容                                                                                                      | 结果 | 截图                                                                                                                                                                                                                                       |
| --- | -------------- | ----------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | 首页与关卡选择 | 外壳、主题 token、首页内容、路由跳转、3 个关卡条目、未解锁不可进入                                                | 通过 | [01-home.png](../screenshots/01-home.png)、[02-levels.png](../screenshots/02-levels.png)                                                                                                                                                   |
| 2   | 游玩页         | 资源加载完成、开始覆盖层、Canvas 渲染、键盘移动、金币收集（得分 0→10）、暂停/继续、重开（得分回到 0）             | 通过 | [03-play-start.png](../screenshots/03-play-start.png)、[04-play-gameplay.png](../screenshots/04-play-gameplay.png)、[05-play-collected.png](../screenshots/05-play-collected.png)、[06-play-paused.png](../screenshots/06-play-paused.png) |
| 3   | 设置与持久化   | 昵称输入、音量滑杆、静音、保存状态、刷新后昵称/音量/静音从 localStorage 恢复                                      | 通过 | [07-settings.png](../screenshots/07-settings.png)                                                                                                                                                                                          |
| 4   | 倒计时与结算   | 真实等待 30 秒倒计时结束，自动进入 `#/result`，显示本局得分与历史最高；点击“重玩本关”返回第一关并重新出现开始面板 | 通过 | [08-result.png](../screenshots/08-result.png)、[10-result-replay.png](../screenshots/10-result-replay.png)                                                                                                                                 |
| 5   | 移动端首页     | 390×844 下首页渲染正常，无横向滚动                                                                                | 通过 | [09-mobile-home.png](../screenshots/09-mobile-home.png)                                                                                                                                                                                    |

运行耗时约 72 秒（含 30 秒真实倒计时）。所有用例同时断言页面无未捕获异常（`pageerror` 为空）。

## H02–H04 扩展验收

| 项目              | 自动验证内容                                                                               | 结果                                                             | 证据                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| H02 输入法/焦点   | 设置页触发组合输入事件后保存中文昵称；焦点保持；`ArrowLeft` 后光标位置保持；刷新后昵称恢复 | 通过（DOM 组合事件模拟）                                         | [11-ime-settings.png](../screenshots/11-ime-settings.png)                                       |
| H02 历史导航      | 首页→关卡→游玩→回退两次→前进一次，URL 与页面内容一致                                       | 通过                                                             | [12-history-levels.png](../screenshots/12-history-levels.png)                                   |
| H02 往返缓存      | 从 `about:blank` 返回应用，页面恢复且可继续开始游戏；记录 `pageshow.persisted`             | 页面恢复通过；自动化环境 **未进入 bfcache**（`persisted=false`） | [13-bfcache-restored.png](../screenshots/13-bfcache-restored.png)、[history.json](history.json) |
| H02 触控          | 390×844 触控进入关卡、点击开始、点击暂停 HUD                                               | 通过（HUD 触控；游戏本阶段无指针移动玩法）                       | [14-mobile-touch-paused.png](../screenshots/14-mobile-touch-paused.png)                         |
| H03 首次音频解锁  | 首次点击“开始”后创建 1 个 AudioContext 且 `running`，音乐 source 已启动                    | 通过                                                             | [15-audio-muted.png](../screenshots/15-audio-muted.png)                                         |
| H03 后台恢复/静音 | 模拟页面隐藏再恢复：Canvas 自动暂停/恢复，音乐 source 重启；静音增益保持 0                 | 通过（模拟 visibility，不是真实手机后台）                        | [16-background-resumed.png](../screenshots/16-background-resumed.png)                           |
| H03 主题真实画面  | 默认主题金币为金色；森林主题构建后同一 Canvas 金币为绿色；同一资源键驱动 DOM/Canvas        | 通过                                                             | [18-forest-play.png](../screenshots/18-forest-play.png)                                         |
| H03 重复进出      | 3 次进入/离开游玩页后仅保留 1 个 AudioContext，旧 Canvas 全部移除，资源重新加载            | 通过                                                             | [17-reentry.png](../screenshots/17-reentry.png)                                                 |
| H04 构建体积      | 默认构建 144,553 B；森林构建 144,551 B（约 0.14 MiB）                                      | 已测量                                                           | [metrics.json](metrics.json)                                                                    |
| H04 帧耗时        | 第一关连续 180 帧：平均 16.67 ms，P95 16.80 ms，最小 16.4 ms，最大 17.0 ms（约 60 FPS）    | 已测量                                                           | [19-performance-play.png](../screenshots/19-performance-play.png)                               |
| H04 内存          | 3 次进出后 JS heap：3.46 MiB → 4.16 MiB（+0.69 MiB，单次结果，不构成泄漏结论）             | 已测量                                                           | [metrics.json](metrics.json)                                                                    |
| H04 规模          | 第一关 1 个玩家 + 5 枚金币（6 个实体）；未做大规模实体压力场景                             | 已记录                                                           | [metrics.json](metrics.json)                                                                    |

### H02–H04 中发现并修复的问题

1. **Hash 历史驱动的旧抑制标记会吞掉真实回退**
   - 现象：从游玩页连续回退到初始 `#/` 时 URL 已变，但页面仍停留在关卡页；用脚本重复 `page.goto('#/play/one')` 也可能停在旧页面。
   - 修复：`runtime/router/history.ts` 在任一 hashchange 后清除抑制标记，`replace` 不再设置抑制标记，`push` 仅在 URL 真变化时设置。
   - 回归：新增真实回退场景断言；Router 14 项测试通过。
2. **音量/静音只在设置页恢复**
   - 修复：AppShell 启动时加载设置并应用到音频服务，刷新后直接进入游玩也保持静音/音量。
3. **后台恢复缺少音频处理**
   - 修复：`main.ts` 监听 `visibilitychange`，隐藏时暂停音乐、恢复时继续；手动静音不会被恢复取消。
4. **森林主题缺少可验证的构建切换**
   - 增加构建常量 `__JCC_THEME__`，默认 `default`；`tests/browser/build-forest.mjs` 生成森林主题产物，用于真实 Canvas 像素对比。
5. **移动端暂停面板与 HUD 状态重叠**
   - 修复：暂停时隐藏 HUD 状态/操作行并提高遮罩不透明度；移除按钮点击高亮残留。
6. **浏览器测试可能使用旧包 dist**
   - `test:browser` 现在先执行 `build:packages`，再构建默认/森林产物，避免运行到过期运行时。

## 验收中发现并修复的问题

1. **条件/列表/slot 模板内容缺少样式作用域属性**
   - 现象：开始面板与暂停面板文字无样式、互相重叠；关卡列表的块内元素也拿不到组件作用域样式。
   - 原因：组件挂载时只为初始模板元素写入 `data-jcc-*` 作用域属性；`when/each/slot` 克隆出来的内容没有补写。
   - 修复：`runtime/template.ts` 在创建块容器、列表项与 slot 克隆后统一应用作用域属性。
   - 回归：组件/结构/参考游戏 23 项 Node 测试全部通过。

2. **初始暂停面板与开始面板同时出现**
   - 现象：进入游戏页、尚未点击“开始”时，HUD 因引擎预暂停而显示“已暂停”面板，与开始覆盖层叠加。
   - 修复：HUD 新增 `started` 输入，暂停面板条件改为 `paused && started`；页面传入 `started` 信号。
   - 回归：HUD 定向测试更新并通过。

3. 页面宿主不是自定义标签本身
   - 路由 outlet 使用 `router-page` 宿主挂载页面，因此验收选择器改为页面内类名/`.app-main`，不将组件选择器当作 DOM 标签依赖。

## 产物

- Playwright HTML 报告：[html/index.html](html/index.html)
- 机器可读结果：[results.json](results.json)
- H02 历史/bfcache 数据：[history.json](history.json)
- H04 性能数据：[metrics.json](metrics.json)
- 基础用例源码：[reference-game.spec.ts](../reference-game.spec.ts)
- H02–H04 用例源码：[advanced-acceptance.spec.ts](../advanced-acceptance.spec.ts)
- 森林主题构建脚本：[build-forest.mjs](../build-forest.mjs)
- 静态服务脚本：[serve.mjs](../serve.mjs)
- 截图目录：[../screenshots](../screenshots)

## 未覆盖 / 仍需人工验收

- **真实输入法**：本次用 DOM `compositionstart/end` 模拟中文组合输入，未调用操作系统输入法；真实中文候选窗、组合期间光标与焦点体验仍需设备人工确认（H02）。
- **真实触控与触控坐标**：本次通过触控模拟验证 HUD 按钮；参考游戏当前使用键盘移动，不含指针/触控移动玩法，Canvas 触控坐标只由 Node 注入几何测试覆盖（H02）。
- **bfcache**：自动化 Chrome 未进入往返缓存（`pageshow.persisted=false`），只验证了回退/前进与重新加载后的页面恢复；真实浏览器往返缓存需人工确认（H02）。
- **音频可听性**：已自动验证 AudioContext 解锁、音乐 source 启动、后台暂停/恢复与静音增益；headless 无音频输出，听感、手机后台和锁屏恢复仍需人工（H03）。
- **性能范围**：仅测量第一关 6 个实体、3 秒 180 帧与 3 次进出的单次堆内存；未做大规模实体压力、长时间运行或多设备测量，不据此宣称通用性能上限（H04）。
- **手机真机与缩放**：移动端为 390×844 设备模拟，不代表真机手势、安全区、软键盘与屏幕阅读器表现。
- 本次未验证 Firefox/Safari 或真实后端网络环境。

结论：H01 自动流程通过；H02/H03 的自动可验证部分通过；H04 已完成当前参考规模的构建体积、帧耗时与内存测量。H02、H03 的真实设备项仍保留在 `tasks/todo.md` 供后续人工验收。
