# 镜川初应用套件模板

本地 0.4.0 的 TS 浏览器项目：app/contracts/game/ui/styles 分层，defineGame/defineScene/defineInput/defineView 与 bootstrapGame 完成组装。

```bash
npm install
npm run check
npm run build
npm run dev
npm run generate -- view score-panel
npm run generate -- scene menu
```

Vite 插件自动关联组件同名 HTML 和 CSS/Less；不手动 import 模板/样式。check 执行结构、组件资源/绑定和 TS 检查。组件可使用 data-text、data-attr-_、data-on-_ 和 data-ref。普通 CSS 由编译器隔离，Less 可导入共享变量。CLI create 可通过 --style less 自动配置。

使用分发套件中的模板或 CLI --bundle 创建项目；新 app/tooling 尚未发布 npm。直接克隆本目录开发时需先在引擎仓库构建包，再使用本地依赖。

UI 不访问 Engine/World；展示状态与命令契约在 contracts/application.ts，应用控制在 app/game.ts，固定步玩法在 game。旧 GameView/GameHud 保留作手工模板迁移参考，新启动路径仅用 GameApp/GameControls。浏览器验证由使用者执行。
