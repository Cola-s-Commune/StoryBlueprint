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

## Current: Milestone 6 → Compiler / Preview

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

**[M7/M8] Compiler + Runtime Preview**

- 把 Typed Story Graph 编译为 Runtime Program
- 实现 Dialogue / Choice / Branch / End 的最小执行器
- 编辑器内运行当前 Story
- 见 `docs/task.md` → Milestone 7 / 8

---

## Recent changes

| Date       | What                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------ |
| 2026-07-25 | Inspector 默认宽度提升到 28%；Resource Browser、Inspector、Console 支持拆分为原生浮动窗口并在关闭后自动回停靠区    |
| 2026-07-25 | 使用 `@bgotink/kdl` 实现当前基础节点的 `.story` Parse / Serialize 与稳定格式化，往返烟雾测试通过                   |
| 2026-07-25 | 完成 New / Open / Save / Save As 文件菜单、快捷键与 Electron IPC；未保存修改在关闭、New、Open 前受到保护           |
| 2026-07-25 | 重建原先不完整的 package-lock，并将根与 editor 的 Electron 统一固定为 31.0.0                                       |
| 2026-07-25 | 图状态提升到 StoryGraph Store，StoryGraph 与 Inspector 共享同一个 EditorGraphState                                 |
| 2026-07-25 | 完成右键节点创建菜单；Story Entry 保持单实例，创建操作进入 Undo / Redo                                             |
| 2026-07-25 | Inspector 支持节点名称、Dialogue、Choice、Branch、Start、End 属性双向编辑，编辑事务可撤销                          |
| 2026-07-25 | 完成单选、多选、框选、删除、Copy / Paste / Duplicate，以及节点移动和图编辑的 Undo / Redo                           |
| 2026-07-25 | 建立 EditorGraphState → SourceGraph 转换；复制子图会重建 Node、Choice Option、Edge ID 并保持内部连接               |
| 2026-07-25 | 完成 Typed Graph 端口解析与连线校验：方向、执行/数据类型、动态端口、重复连接和连接占用规则                         |
| 2026-07-25 | React Flow 接入统一校验，非法连线显示错误提示，Edge 使用稳定 ID                                                    |
| 2026-07-25 | 建立 Source Model、稳定 ID、表达式、Runtime Program/State、Adapter 类型契约与 Runtime 控制流校验                   |
| 2026-07-25 | 节点持久化类型统一为 `story-entry/end-story`，静态端口由 Node Definition 派生，Choice 输出声明为动态端口           |
| 2026-07-25 | 补齐 common → compiler/runtime/sdk 的 TypeScript project references                                                |
| 2026-07-23 | 修复 tsc 泄漏产物导致节点消失：清理 src 中 .d.ts/.d.ts.map/.js/.js.map，registerBuiltins 从 useEffect 提到模块顶层 |
| 2026-07-23 | 修复 tsc 在 src/renderer 中生成 .js 文件导致 Vite esbuild JSX 解析错误                                             |
| 2026-07-23 | M2 节点系统：NodeRegistry + NodeFactory + 5 种自定义节点组件                                                       |
| 2026-07-23 | M1 StoryGraph 画布：React Flow 集成、背景网格、MiniMap、测试节点                                                   |
| 2026-07-23 | 从 pnpm 切换到 npm（pnpm 的嵌套 node_modules 导致 Electron 模块遮蔽问题）                                          |
| 2026-07-23 | M1 布局框架完成，Electron 可在外部终端正常启动                                                                     |
| 2026-07-23 | M0 项目初始化完成：workspace、TS、ESLint、Prettier、Electron + React 骨架                                          |
