# Dev Log

> 人机共读开发日志。新机器 clone 后看这里就能接上。

---

## How to run

```bash
npm install
npm run dev
```

如果报 Electron 崩溃：先 `set NODE_OPTIONS=` 清掉环境变量再试。

---

## Current: Milestone 1 — Main Window Layout

### Done

- Electron + React 项目骨架（npm workspaces + electron-vite + TypeScript）
- 主窗口布局：Dock 风格三栏 + 底部 Console
  - 左侧 ResourceBrowser (20%) | 中间 StoryGraph (60%) | 右侧 Inspector (20%)
  - 中间上下分割：StoryGraph (75%) + Console (25%)
- MenuBar（File/Edit/View/Help 菜单 + 快捷键标注）
- StatusBar（底部状态栏）
- 四个面板占位组件
- TypeScript 编译零错误

### Next

**[M1] StoryGraph 画布：接入 React Flow**

- 安装 `@xyflow/react`（reactflow v12）
- 实现无限画布、缩放、平移
- 添加 MiniMap 和 Background Grid
- 画布上能放置一个测试节点

见 `docs/task.md` → Milestone 1 → StoryGraph 详细��目。

---

## Recent changes

| Date | What |
|------|------|
| 2026-07-23 | 从 pnpm 切换到 npm（pnpm 的嵌套 node_modules 导致 Electron 模块遮蔽问题） |
| 2026-07-23 | M1 布局框架完成，Electron 可在外部终端正常启动 |
| 2026-07-23 | M0 项目初始化完成：workspace、TS、ESLint、Prettier、Electron + React 骨架 |
