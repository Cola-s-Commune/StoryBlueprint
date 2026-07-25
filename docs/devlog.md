# Dev Log

> 人机共读开发日志。新机器 clone 后看这里就能接上。

---

## How to run

```bash
npm install
npm run dev
```

`packages/editor/scripts/dev.cjs` 会自动清除 `ELECTRON_RUN_AS_NODE` 和 `NODE_OPTIONS`（WorkBuddy/Electron 父进程继承的脏环境变量）。

如果 wrapper 不生效，手动：`unset ELECTRON_RUN_AS_NODE && unset NODE_OPTIONS && npm run dev`

---

## Current: Milestone 1 → Milestone 2

### M1 Done

- Electron + React 项目骨架（npm workspaces + electron-vite + TypeScript）
- 主窗口布局：Dock 风格三栏 + 底部 Console
- MenuBar / StatusBar
- StoryGraph 画布接入 React Flow（无限画布、背景网格、MiniMap、Controls）

### M2 Done (Node System)

- `packages/common/src/types/nodes.ts` — StoryNodeType 枚举 + 5 种节点数据接口 + NodeDefinition
- `packages/common/src/registry/nodeRegistry.ts` — 注册表：register / get / has / list / listByCategory + 5 种内置类型
- `packages/common/src/registry/nodeFactory.ts` — 工厂：create(id, type, position) + generateId
- `packages/editor/.../Nodes/` — 5 种自定义 React Flow 节点组件（Start / Dialogue / Choice / Branch / End）
- StoryGraph 已接入 nodeRegistry + nodeTypes 映射，使用工厂生成演示节点
- `npm run build` 全套构建通过

### Next

**[M2] Edge 连线系统**

- Connection validation（类型校验，不允许非法连线）
- Edge delete
- 见 `docs/task.md` → Milestone 2 → Edge

---

## Recent changes

| Date | What |
|------|------|
| 2026-07-23 | 修复 tsc 泄漏产物导致节点消失：清理 src 中 .d.ts/.d.ts.map/.js/.js.map，registerBuiltins 从 useEffect 提到模块顶层 |
| 2026-07-23 | 修复 tsc 在 src/renderer 中生成 .js 文件导致 Vite esbuild JSX 解析错误 |
| 2026-07-23 | M2 节点系统：NodeRegistry + NodeFactory + 5 种自定义节点组件 |
| 2026-07-23 | M1 StoryGraph 画布：React Flow 集成、背景网格、MiniMap、测试节点 |
| 2026-07-23 | 从 pnpm 切换到 npm（pnpm 的嵌套 node_modules 导致 Electron 模块遮蔽问题） |
| 2026-07-23 | M1 布局框架完成，Electron 可在外部终端正常启动 |
| 2026-07-23 | M0 项目初始化完成：workspace、TS、ESLint、Prettier、Electron + React 骨架 |
