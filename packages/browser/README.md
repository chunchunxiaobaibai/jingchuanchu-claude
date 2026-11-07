# @xiaobaibaifqy/jingchuanchu-browser

浏览器循环与页面可见性。依赖 core；不默认启动网络。

## 安装

公共 npm 安装：

```bash
npm install @xiaobaibaifqy/jingchuanchu-browser
```

也可通过镜川初分发套件的 install.mjs 选择模块，自动补齐内部依赖。本地 tgz 安装时需同时提供所需内部包。

## 使用

```ts
import { Engine } from '@xiaobaibaifqy/jingchuanchu-core';
import { browserModule } from '@xiaobaibaifqy/jingchuanchu-browser';
const engine = new Engine();
engine.install([browserModule()]);
engine.start();
window.addEventListener('pagehide', () => engine.dispose(), { once: true });
```

包提供 ESM、TypeScript 声明与源码。TS >=5.4；浏览器功能需要对应浏览器 API，服务端开发使用 Node >=22.12。完整 API、模块组合和可运行模板在分发套件 docs/development 中。

## 0.4.0 扩展

原 browserModule/runBrowser 调用方式保留。下一版本新增 createFrameLoop，runBrowser 与应用层 GameCanvas 共用这一帧调度。新的相机、精灵和场景能力在 renderer-2d/features 与 core/scenes 中按需接入，不需要让浏览器循环依赖联网。

本仓库 0.4.0 尚未上传 npm，新增能力请使用本地 tgz 或分发套件；公共包当前为 0.3.0。完整契约见分发套件 `docs/development/extensions-0.4.md`。

新增 `/dom` 子入口的 `setText` 与 `createKeyedList`，按实际文本/行数据更新并复用列表节点。实例应只在容器挂载时创建，详见分发手册 `docs/development/rendering-updates.md`。

## 授权

MIT，见 [LICENSE](LICENSE)。
