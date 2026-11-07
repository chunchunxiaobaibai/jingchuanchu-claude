# 镜川初参考游戏

网页 2D 参考游戏模板。页面、组件、Store、路由、主题、Canvas 场景、音频与保存均使用 `@xiaobaibaifqy/jingchuanchu-app/application` 的新模型。

## 开发

```bash
npm install
npm run dev
npm run check
npm run build
```

`npm run dev` 后打开终端提示的地址。首次播放音效需要点击“开始”以完成浏览器音频解锁。

## 目录

- `src/app`：应用配置、路由与外壳。
- `src/pages`：首页、关卡、游玩、设置、结算，均为三文件页面。
- `src/components`：可复用 UI 组件。
- `src/game`：跨页面的游戏 Store、关卡与保存定义。
- `src/themes`：默认与森林主题，所有资源通过 theme 资源键解析。

素材位于 `src/assets`，为项目内生成的简单图形与音调，许可见 [LICENSES.md](LICENSES.md)。
