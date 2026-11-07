# 实施任务

依据 [SPEC](../SPEC.md) 与 [plan](plan.md)。全部为待实施；勾选只表示已满足本行验收和定向验证，不表示已发布或真实浏览器验收完成。表中测试文件由对应任务创建后再运行。

| 状态 / ID | 最小交付与验收                                         | 预计文件范围                                                                   | 定向验证                                                           |
| --------- | ------------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| [x] T01   | signal/computed：同值跳过、派生缓存及动态依赖（R1/R2） | runtime/reactivity.ts、application.ts、app/package.json、reactivity.test.ts    | reactivity.test.ts；入口类型检查                                   |
| [x] T02   | effect 清理、batch、重入诊断与渲染调度协议（R3/R4）    | reactivity.ts、scheduler.ts、reactivity.test.ts                                | reactivity.test.ts                                                 |
| [x] T03   | 定义 input/output/model 和 setup 的类型契约            | runtime/component-types.ts、component.ts、component-types fixture              | 负向/正向类型 fixture                                              |
| [x] T04   | 实例、owner、生命周期和候选挂载回收（C1）              | component.ts、component-owner.ts、component-runtime.test.ts                    | component-runtime.test.ts                                          |
| [x] T05   | 新三文件关联、CSS/Less 和来源信息                      | tooling/compiler.mjs、vite.mjs、component-template.test.ts、资源 fixture       | component-template.test.ts                                         |
| [x] T06   | 表达式/属性/事件的虚拟 TS 类型诊断（C4）               | tooling/template-check.mjs、template 编译器、runtime/template.ts、类型 fixture | 模板定向测试、类型 fixture                                         |
| [x] T07   | 原生和自定义 model、转换、输入法状态（C2）             | runtime/models.ts、template.ts、template-check.mjs、form-model.test.ts         | form-model.test.ts；只读 model 负向类型                            |
| [x] T08   | when/each/key/slot 与 nextTick（C3）                   | template.ts、component.ts、模板编译器、component-runtime.test.ts               | 实例/分支/重排/slot 定向测试                                       |
| [x] T09   | Store state/getters/actions、按 owner 实例化（S1/S2）  | runtime/store.ts、component-owner.ts、stores.test.ts、类型 fixture             | stores.test.ts；类型检查                                           |
| [x] T10   | Store reset、异步代次和 user-scoped 标记（S3）         | store.ts、stores.test.ts                                                       | stores.test.ts                                                     |
| [x] T11   | 类型化服务定义和父子 owner 解析（A1/A3）               | runtime/services.ts、application-types.ts、services.test.ts                    | services.test.ts                                                   |
| [x] T12   | defineApplication/mount/bootstrap 和失败回收（A2）     | application.ts、application 入口、application-runtime.test.ts                  | application-runtime.test.ts；旧 mountGame fixture                  |
| [x] T13   | 路由 types/matcher/HistoryDriver（P1）                 | runtime/router/types.ts、matcher.ts、history.ts、router.test.ts                | router.test.ts                                                     |
| [x] T14   | 守卫、prepare、提交/取消/回滚（P3）                    | router/router.ts、router.test.ts                                               | router.test.ts                                                     |
| [x] T15   | router-outlet、route-link、嵌套页面 owner              | runtime/router/components.ts、template 接口、router.test.ts                    | Node DOM 导航集成                                                  |
| [x] T16   | loader 去重、preload 策略、拆块验证（P2/P4）           | router/loader.ts、router-loading.test.ts、Vite fixture、构建断言               | router-loading.test.ts；一次拆块构建                               |
| [x] T17   | 资源描述/decoder/并发及条目进度（L1/L3）               | runtime/assets.ts、asset-types.ts、asset-groups.test.ts                        | asset-groups.test.ts                                               |
| [x] T18   | 分组 lease、取消/晚到资源/失败重试（L2）               | assets.ts、asset-groups.test.ts                                                | asset-groups.test.ts                                               |
| [x] T19   | 主题定义、token、整体覆盖与 DOM/Canvas 解析（T1—T3）   | runtime/theme.ts、theme-types.ts、themes.test.ts、主题类型 fixture             | themes.test.ts；类型 fixture                                       |
| [x] T20   | contain 视口、尺寸变化与坐标映射（V1）                 | runtime/viewport.ts、viewport-input.test.ts                                    | 注入几何驱动测试                                                   |
| [x] T21   | 键盘/主指针/虚拟按键动作采样及清理（V2/V3）            | runtime/input-actions.ts、viewport-input.test.ts                               | 动作/焦点/暂停定向测试                                             |
| [x] T22   | 游戏 clock 单次/重复/取消（F1）                        | runtime/game-clock.ts、game-feedback.test.ts                                   | 手动 advance 测试                                                  |
| [x] T23   | 数值缓动、完成/取消和错误来源（F2/F3）                 | runtime/tweens.ts、game-feedback.test.ts                                       | game-feedback.test.ts                                              |
| [x] T24   | GameCanvas、defineGameScene、页面所属循环（H1—H3）     | runtime/canvas-host.ts、canvas-host.test.ts、注入驱动 fixture                  | canvas-host.test.ts                                                |
| [x] T25   | AudioDriver、解锁/播放结果及分组音量（U1）             | runtime/audio.ts、audio-driver.ts、audio.test.ts                               | 注入 AudioDriver 测试                                              |
| [x] T26   | 音频 owner 清理、暂停恢复与偏好接口（U2/U3）           | audio.ts、audio.test.ts                                                        | audio.test.ts                                                      |
| [x] T27   | StorageAdapter、版本记录、选择/parse/迁移（D1）        | runtime/save-data.ts、save-data.test.ts                                        | save-data.test.ts                                                  |
| [x] T28   | 坏档、reset 和用户命名空间（D2/D3）                    | save-data.ts、save-data.test.ts                                                | save-data.test.ts                                                  |
| [x] T29   | Provider、会话状态与身份代次（I1/I2）                  | runtime/auth.ts、auth-session.test.ts、Provider fixture                        | auth-session.test.ts                                               |
| [x] T30   | 权限 all/any、公共/受保护策略及守卫（Q1/Q2）           | runtime/access.ts、access-policy.test.ts、Router fixture                       | access-policy.test.ts                                              |
| [x] T31   | 后端适配示例及绕过前端仍拒绝（I3/Q3）                  | examples/auth-adapter/ 的协议/客户端/服务端、集成测试                          | 注入/本地服务端定向检查，不开浏览器                                |
| [x] T32   | schemaVersion/profile/paths 与新旧项目诊断             | tooling/project-config.mjs、check-project、project-structure.test.ts           | project-structure.test.ts                                          |
| [x] T33   | create 与 page/component 生成及安全注册（J1/J2）       | tooling/cli.mjs、scaffold.mjs、project-config.mjs、scaffold.test.ts            | scaffold.test.ts                                                   |
| [x] T34   | scene/store/theme 生成，冲突全量预检（J2）             | scaffold.mjs、生成模板、scaffold.test.ts                                       | scaffold.test.ts                                                   |
| [x] T35   | add 指定/全部包、vendor/开发依赖（J3）                 | tooling/install.mjs、cli.mjs、scaffold.test.ts、安装 fixture                   | 指定/全部包独立安装                                                |
| [ ] T36   | application 新入口打包、旧消费者、新模板诊断（J4）     | app exports、构建脚本、verify-app-suite.ts、architecture.test.ts、消费 fixture | typecheck、test:api、一次 tgz 消费                                 |
| [x] T37   | 默认 AppShell 三文件及 app-config/app-routes           | templates/browser/src/app 的 5 个文件                                          | 定向模板编译，不先扩大到分发                                       |
| [x] T38a  | 首页入口与共享 GameStore                               | home 三文件、game-store、路由注册                                              | Store/导航集成，模板检查                                           |
| [x] T38b  | 关卡选择页及带参数导航                                 | level-select 三文件、路由注册、页面集成测试                                    | 参数/选关/共享状态集成                                             |
| [x] T39   | 可复用 HUD 与暂停面板                                  | play 私有组件三文件、组件集成 fixture                                          | model/输出及暂停交互的 Node DOM 检查                               |
| [x] T40   | 游戏页/场景：动作、收集、计时和重开                    | play 三文件、play-scene.ts、玩法测试                                           | 手动 advance 的玩法与清理测试                                      |
| [x] T41   | 设置页：昵称、音量/静音与偏好                          | settings 三文件、偏好 Store、路由注册                                          | 表单/音频/保存适配集成                                             |
| [x] T42   | 结算页、进度保存和返回流程                             | result 三文件、保存定义、路由注册                                              | 进度/重开/返回的自动集成                                           |
| [x] T43a  | 两套主题与资源许可清单                                 | theme 定义、资源声明、许可清单；素材为最小必要资产                             | 主题替换和资源类型检查                                             |
| [x] T43b  | 加载反馈与游玩音效接入                                 | 加载 UI、资源组声明、游戏音频接入、集成测试                                    | 加载/取消/播放结果集成                                             |
| [x] T44   | 默认项目独立构建与文档迁移                             | 模板配置/README、迁移手册、verify-app-suite.ts                                 | check:templates、test:project、dist:release、test:app:distribution |

## 人工/浏览器验收（不自动执行）

> T36 备注：typecheck、旧入口架构检查与打包后的 tgz 独立消费已通过；当前仓库缺少 `v0.3.0` 历史标签，`npm run test:api` 无法读取基线，需在有该标签的环境中补跑。

- [x] H01 获得明确授权后：实际游玩加载→关卡→暂停→设置→结算→重开，记录浏览器及目标设备。
  - 2026-10-17：Playwright + Google Chrome 155.0.8059.80（headless，桌面 1280×800；移动视口 390×844）通过；详见 `tests/browser/report/report.md` 与 `tests/browser/screenshots/`。
- [ ] H02 获得明确授权后：输入法、焦点/光标、触控坐标、前进后退及往返缓存恢复。
  - 2026-10-17 自动部分：组合输入事件、焦点/光标、触控 HUD、前进后退通过；自动化 Chrome 未进入 bfcache（`persisted=false`），真实系统输入法、触控坐标与 bfcache 仍需真机人工复核。证据见 `tests/browser/report/report.md`、`history.json` 与截图 11–14。
- [ ] H03 获得明确授权后：首次音频解锁、后台恢复、主题真实画面及重复进出后的资源表现。
  - 2026-10-17 自动部分：AudioContext 解锁/运行、静音保持、visibility 后台暂停恢复、森林主题 Canvas 画面、3 次重复进出资源释放通过；headless 无音频输出，听感与手机后台仍需人工。证据见报告、截图 15–18。
- [x] H04 根据实际性能问题或交付需要测量实体规模、帧耗时/内存与构建体积；未经测量不填结论。
  - 2026-10-17 已测量：默认/森林构建约 0.14 MiB；第一关 6 个实体、180 帧平均 16.67 ms（约 60 FPS）；3 次进出 JS heap 3.46→4.16 MiB（单次）。仅代表当前参考规模，未做压力场景。数据见 `tests/browser/report/metrics.json`。

自动项完成而人工项未验收时，在交付记录中明确区分，不用一行“测试通过”合并两者。
