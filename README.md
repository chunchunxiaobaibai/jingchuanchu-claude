# 镜川初 · Jingchuanchu Engine

面向网页 2D 游戏的 TypeScript ECS 引擎。引擎与具体玩法解耦，按需组合单机、渲染、输入、资源及联机功能。引擎与游戏都使用 TypeScript。

当前引擎版本为 **0.4.0**，通过本地安装包和分发套件使用，无需 npm 发布权限；公共 npm 仍为 **0.3.0**。采用 [MIT](LICENSE) 授权，8 个原有引擎包均提供 ESM、类型声明和源码；除服务端使用 `ws` 外，没有第三方运行依赖。

当前采用 **GitHub 源码与 Release 预构建套件交付，暂不发布 npm 0.4.0**。项目仓库为 [chunchunxiaobaibai/jingchuanchu](https://github.com/chunchunxiaobaibai/jingchuanchu)，问题与建议可提交到 [Issues](https://github.com/chunchunxiaobaibai/jingchuanchu/issues)。GitHub 的源码压缩包不含构建产物，使用新套件请先按下面步骤构建；不要通过公共 npm 安装旧版后期待获得 app/tooling。

## 下载预构建套件（无需构建引擎）

前往 [v0.4.0 Release](https://github.com/chunchunxiaobaibai/jingchuanchu/releases/tag/v0.4.0)，下载 Assets 中的 `jingchuanchu-engine-0.4.0.zip` 或 `.tar.gz`，按需核对配套 `.sha256`。二者内容相同；GitHub 自动生成的 Source code 附件只提供源码。

解压并保留目录结构，准备 Node.js >=22.12 和 npm：

```bash
cd jingchuanchu-engine-0.4.0/starters/browser
npm install
npm run dev
```

随后可用 `npm run generate -- page settings --route /settings`、`npm run generate -- component hud --page play` 创建功能，`npm run build` 打包游戏。无需编译引擎或登录 npm；开发依赖仍需下载或已有缓存。迁移独立游戏时保留其引用的 tgz，或按 [应用套件手册](docs/development/application-suite.md) 保存到 vendor。新的默认项目模型与旧命令对照见 [迁移指南](docs/development/migrating-to-application.md)。

## 从源码构建

希望自行构建或修改引擎时，按下列流程创建游戏。构建固定版本可在 clone 时加上 `--branch v0.4.0`，默认分支 dev 则跟随最新源码。完整的环境准备、各构建命令区别、产物位置、游戏打包及升级步骤见 [源码构建指南](docs/development/build-from-source.md)。

准备 Node.js >=22.12、npm、Git 和 tar。在 Windows 或 WSL 中选择一个环境完成依赖安装与构建，不共用两种平台安装的 node_modules。

```bash
git clone https://github.com/chunchunxiaobaibai/jingchuanchu.git
cd jingchuanchu
npm ci
npm run dist:release
node packages/tooling/dist/cli.mjs create ../my-game --preset singleplayer --style css --bundle ./dist/releases/jingchuanchu-engine-0.4.0
cd ../my-game
npm install
npm run build
npm run dev
```

默认开发地址为 http://localhost:5175 。这是游戏项目的启动命令；引擎仓库本身没有根目录 dev 入口。生成器将所需引擎 tgz 保存到游戏的 vendor，后续迁移不依赖引擎仓库路径。引擎无需 npm 登录；安装开发依赖仍需要网络或本机缓存。

`--style less` 选择 Less，`--preset client` 生成网络客户端；core、server 预设见 [应用套件手册](docs/development/application-suite.md)。更新仓库后重新生成套件；已有游戏的升级应显式更新 vendor 和依赖，不会由 git pull 自动完成。

## 安装与开发游戏

在本仓库生成 0.4.0 分发套件：

```bash
npm ci
npm run dist:release
```

接入其他项目（PowerShell 示例，替换目标路径）：

```powershell
node "E:\CodexProject\xiaobaifqy-engine\dist\releases\jingchuanchu-engine-0.4.0\install.mjs" --preset singleplayer --target "E:\MyGame"
```

安装器会选择本地 tgz 并补齐内部依赖。`core` 用于仅内核，`singleplayer` 用于网页单机，`client` 加入网络客户端，`server` 用于 Node 服务端。无需登录 npm；`server` 的外部依赖 `ws` 仍需下载或已缓存。

项目依赖会引用分发目录里的 tgz，请保留该目录。需要独立迁移或提交项目时，将选中的 tgz 复制到项目 `vendor/`，以本地相对路径重新安装，并保存 vendor、package.json 和锁文件。升级时重新生成并安装所有选中模块及其依赖，不能只替换一个包。详见 [本地分发与安装](docs/development/distribution.md)。

以下公共 npm 命令安装的是已发布的 0.3.0。仅使用内核，ECS 会自动补齐：

```bash
npm install @xiaobaibaifqy/jingchuanchu-core
```

网页单机组合：

```bash
npm install @xiaobaibaifqy/jingchuanchu-core @xiaobaibaifqy/jingchuanchu-browser @xiaobaibaifqy/jingchuanchu-renderer-2d @xiaobaibaifqy/jingchuanchu-input
```

按需加入 `@xiaobaibaifqy/jingchuanchu-assets`、`@xiaobaibaifqy/jingchuanchu-net` 或 `@xiaobaibaifqy/jingchuanchu-net-server`。安装单机组合不会引入服务端 `ws`。

从 [快速入门](docs/development/getting-started.md) 和 [开发手册](docs/development/README.md) 开始。推荐通过上面的 CLI 创建游戏；直接复制源码模板时还需配置本地安装包依赖。浏览器需要 ES2022、Canvas 2D 和 Pointer Events；TS 消费项目需要 TypeScript >=5.4。引擎不提供 CommonJS 构建。

可选应用套件与代码生成脚手架现已提供，包含三文件自动关联、CSS/Less 和实例生命周期。创建项目与迁移请见 [应用套件手册](docs/development/application-suite.md)。本地交付共 10 个包，公共 npm 版本未更新。

## 模块

| 包名后缀    | 职责                                         |
| ----------- | -------------------------------------------- |
| ecs         | 实体、代际 ID、组件查询、资源与延迟命令      |
| core        | 固定步长、系统、模块依赖、事件与资源清理     |
| browser     | 浏览器主循环、页面可见性与暂停恢复           |
| renderer-2d | Canvas 2D、坐标转换、基础图形与笔画          |
| input       | 键盘、指针输入与捕获清理                     |
| assets      | 共享加载缓存、失败重试与资源释放             |
| net         | 浏览器连接、消息解码、房间目录与限流         |
| net-server  | Node WebSocket、心跳、消息大小与发送积压保护 |
| app         | 类型化应用、场景、输入、视图与生命周期       |
| tooling     | 开发期组件编译、CSS/Less、项目及代码生成     |

完整包名为 `@xiaobaibaifqy/jingchuanchu-<后缀>`。各包的普通入口可直接使用，模块入口负责注册服务、系统和清理；详见 [模块指南](docs/modules.md)。

## 维护仓库

需要 Node.js >=22.12、npm 和 tar。从仓库根目录运行：

```bash
npm ci
npm run build
npm test
npm run test:packages
npm run format:check
```

`build` 只执行严格类型检查和引擎包构建。根目录没有游戏启动入口。

```text
packages/       8 个原有引擎包、app 运行包与 tooling 开发包
scripts/        构建、打包和独立消费验证
tests/         引擎回归测试（不含具体游戏规则）
docs/           开发手册、架构与维护说明
distribution/   分发套件的说明模板
templates/      可运行 TS 浏览器 starter
examples/       内核、资源、自定义模块及网络接入示例
```

`tests/` 与最小示例用于维护和验证发行版。`node_modules/` 是开发依赖，`dist/` 是可重新生成的安装包与交付套件，都不提交源码仓库。历史游戏及临时任务产物已移除。

## 打包与分发

```bash
npm run pack:packages
npm run dist:release
```

安装包输出到 `dist/packages/`；完整交付套件输出到 `dist/releases/jingchuanchu-engine-0.4.0.tar.gz`，包含 10 个 tgz、校验清单、按需安装器、开发手册与可运行 starter。

默认不启动浏览器的完整外部消费验证：

```bash
npm run test:distribution:node
```

此验证会解压归档，在独立项目检查类型、包边界、模板静态构建和真实网络通信。浏览器操作由用户后续验证；只有明确需要时运行 test:2d 或 test:distribution（需 Chromium 及 Linux 运行库）。项目约定见 AGENTS.md。

- [npm 发布手册](docs/maintainers/npm-publishing.md)：版本维护、WSL 登录、按依赖顺序发布与远端核对。
- [GitHub 交付说明](docs/maintainers/github-delivery.md)：源码更新、可选 Release 附件和版本状态。
- [贡献指南](CONTRIBUTING.md)：问题反馈、修改范围与非浏览器检查。
- [架构说明](docs/architecture.md)、[验证记录](docs/validation.md)、[更新记录](CHANGELOG.md)。

根包为 `private`，分发对象是 `packages/` 内的 10 个包。0.3.0 已发布且不可覆盖；本地 0.4.0 尚未上传 npm，使用新能力请先消费本地 tgz 或分发套件。

0.4.0 新增接口与兼容说明见 [扩展手册](docs/development/extensions-0.4.md)。验证公开名称：`npm run test:api`；真实 Chromium 2D 验证：`npm run test:2d`；性能原始数据见 [测量报告](docs/performance/README.md)。

默认原生 TS 模板按 app、contracts、game、ui 和 styles 分层，UI 使用自动关联的 HTML/TS/CSS 或 Less 三文件组件。结构、组件资源与类型检查接入模板 check/build，跨层依赖、内联代码、未知绑定及资源歧义会阻止构建。详见 [游戏项目规范](docs/development/project-structure.md)。维护模板使用 `npm run check:templates`、`npm run test:project`；生成套件后通过 `npm run test:template` 验证独立消费与静态构建。

## 下一阶段实施

2D 应用框架的范围、模块规格与新旧边界见 [SPEC](SPEC.md)；依赖顺序与检查点见 [plan](tasks/plan.md)，完成状态见 [todo](tasks/todo.md)。新规格描述待实现能力，现有 0.4.0 使用方式与已发布附件保持原样。
