# @xiaobaibaifqy/jingchuanchu-renderer-2d

Canvas 2D 与 Position2D/Shape2D 组件。/module 提供 canvas2DModule 和 Renderer2D 服务 token。

## 安装

公共 npm 安装：

```bash
npm install @xiaobaibaifqy/jingchuanchu-renderer-2d
```

也可通过镜川初分发套件的 install.mjs 选择模块，自动补齐内部依赖。本地 tgz 安装时需同时提供所需内部包。

## 使用

```ts
import { Canvas2D } from '@xiaobaibaifqy/jingchuanchu-renderer-2d';
const canvas = document.querySelector<HTMLCanvasElement>('canvas');
if (!canvas) throw new Error('Create a canvas first');
const renderer = new Canvas2D(canvas);
renderer.clear();
renderer.stroke({ color: '#176b58', width: 5, points: [{ x: 20, y: 20 }] });
```

包提供 ESM、TypeScript 声明与源码。TS >=5.4；浏览器功能需要对应浏览器 API，服务端开发使用 Node >=22.12。完整 API、模块组合和可运行模板在分发套件 docs/development 中。

## 0.4.0 扩展

`/features` 提供 Transform2D、Camera2D、Sprite2D、Animation2D、animationModule；`/collision` 提供 Collider2D、detectCollisions、collisionModule。原有 Canvas2D、Position2D 和 Shape2D 保留。Canvas2D 新增 resize/toWorldPoint，drawWorld 可传相机；canvas2DModule 也可传 camera。矩形碰撞使用世界 AABB，非均匀缩放圆使用保守包围圆，不提供刚体响应。下一版本 detectCollisions/collisionModule 可传 `cellSize` 启用可选网格宽阶段，默认仍为 X 轴扫描。

本仓库 0.4.0 尚未上传 npm，新增能力请使用本地 tgz 或分发套件；公共包当前为 0.3.0。完整契约见分发套件 `docs/development/extensions-0.4.md`。

相同尺寸的 resize/重复初始化保留画布缓冲，canvas2DModule 可用 `shouldRender` 跳过不需要的清空和重绘；动画场景默认持续渲染。

## 授权

MIT，见 [LICENSE](LICENSE)。
