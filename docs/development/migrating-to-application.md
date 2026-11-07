# 迁移到 application 项目模型

新创建的单机与客户端项目默认使用可选应用套件：

- `defineComponent` / `definePage`，setup 返回模板可见成员。
- `defineStore`、`defineApplication`、`defineRoutes` 与页面路由。
- `defineTheme`、资源组、音频、保存与可选认证/权限。

旧 `defineView`、`defineGame`、`mountView`、`mountGame` 以及原有核心/ECS/渲染包继续保留原契约。0.4.0 手册描述的行为仍然有效；本页只说明如何主动迁移到新模型。

## 项目配置

新项目 `jingchuanchu.json` 使用：

```json
{
  "schemaVersion": 2,
  "profile": "application",
  "preset": "singleplayer",
  "style": "less",
  "paths": {
    "app": "src/app",
    "pages": "src/pages",
    "game": "src/game",
    "components": "src/components",
    "themes": "src/themes",
    "account": "src/account"
  }
}
```

缺少 `schemaVersion: 2` 的配置继续按 `legacy-v0.4` 识别，`generate view/scene` 和旧结构检查仍可使用。`paths` 必须指向项目内部；目录与业务文件使用小写 kebab-case，三文件同主名。

## 目录与命令

```text
src/
  main.ts
  app/            app-config.ts、app-routes.ts、app-shell.*、services.ts
  pages/          home/、levels/、play/、settings/、result/
  components/     可复用三文件组件
  game/session/   game-store.ts、levels.ts、save.ts
  themes/         default/、forest/
  assets/         图片与音频
  styles/         全局 Less/CSS
```

| 旧命令                      | 新命令                                     |
| --------------------------- | ------------------------------------------ |
| `generate view score-panel` | `generate component score-panel --shared`  |
| 页面内私有组件              | `generate component hud --page play`       |
| 新页面                      | `generate page settings --route /settings` |
| 场景                        | `generate scene play --page play`          |
| 共享 Store                  | `generate store game --domain session`     |
| 主题                        | `generate theme forest --extends default`  |

页面以动态 `loadPage` 注册到 `src/app/app-routes.ts`。组件生成要求明确 `--page` 或 `--shared`，不会猜测全局挂载位置。生成器在写入前预检命名/路由冲突；失败时不留下半成品。

## 组件与模板

```ts
const NicknameEditor = defineComponent({
  selector: 'nickname-editor',
  inputs: { label: input<string>({ default: '昵称' }) },
  outputs: { save: output<string>() },
  models: { value: model<string>({ default: '' }) },
  setup(context) {
    return {
      label: context.inputs.label,
      value: context.models.value,
      save: () => context.emit('save', context.models.value()),
    };
  },
});
```

模板使用 `{{ value }}`、`:attr`、`@event`、`model:value`、`<template when>`、`<template each ... key>` 与 `<slot>`。父模板用 `:input-name` 给子组件传输入，用 `@output` 接收子组件输出（kebab-case 会映射到 camelCase 输入名）。旧 `data-text` / `data-attr-*` / `data-on-*` 只由 `defineView` 管线支持，不应混入新模板。

页面通过 `definePage` 声明，路由 prepare 的返回值作为页面输入。`context.route` 提供只读参数/查询。`context.useStore` / `useService` 从当前 owner 解析；页面退出时其作用域、场景、音频和资源持有会被释放。

## 样式

新组件样式写普通 CSS 或 Less，类名直接写在 HTML，不需要 CSS Modules。编译器为每个组件生成作用域属性并重写选择器；`@keyframes` 同步改名。全局样式只通过 `src/styles/` 与 `src/main.ts` 引入。

## 应用、路由与主题

```ts
export const app = defineApplication({
  root: AppShell,
  routes,
  providers: [{ service: AppServicesDef }],
  onError: console.error,
});
```

`<router-outlet>` 放置在根/布局模板中。路由守卫可读取通用 `meta`，认证项目由 app 装配权限守卫；Router 本身不导入账号模块。主题在 app 配置阶段选择，DOM 与 Canvas 都通过同一资源键解析：

```ts
const service = createThemeService(DefaultTheme, { assets });
service.url('game.coin'); // DOM 图片
await service.loadImage('game.coin'); // Canvas 图片 + frame
```

覆盖主题时只替换对应资源描述；图集区域整体替换为普通图片后不再保留旧 frame。Token 以 `--jcc-*` CSS 变量写入应用根元素。

## 音频、保存与认证

- 音频服务必须在真实用户交互中调用 `unlock()`；locked 时播放返回 `blocked`，不积压等待。
- 保存使用 `defineSave` 与注入的 `StorageAdapter`，只写入显式选择的字段；load 不自动改写业务状态。
- 认证与权限是可选支线；单机项目不生成账号目录。示例适配器见 `examples/auth-adapter`。

## 兼容边界

- 旧项目可继续使用原有 API；新项目默认不附带旧 UI 范式。
- 不要把旧 `defineView` 与新的三文件页面同时挂载在同一界面。
- 仓库中的 `templates/legacy-browser` 仅用于旧生成路径和兼容测试。
- 浏览器首次音频、输入法、触控与真实游玩仍属于人工验收项；静态构建和 Node 测试不能代替这些结论。
