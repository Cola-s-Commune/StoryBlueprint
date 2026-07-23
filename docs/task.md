# Story Blueprint Editor - Task List

> Status: Planning
>
> Goal:
>
> 开发一个独立于游戏引擎的 Blueprint 风格剧情编辑器（Electron + React + TypeScript）。

---

# Milestone 0 - Project Initialization

## Repository

- [ ] 初始化 Git 仓库
- [ ] 配置 pnpm Workspace
- [ ] 创建 packages 目录
- [ ] 配置 TypeScript
- [ ] 配置 ESLint
- [ ] 配置 Prettier
- [ ] 配置 EditorConfig
- [ ] 配置 Git Hooks（Husky）
- [ ] 配置 Commitlint（可选）

---

## Electron

- [ ] 创建 Electron 主进程
- [ ] 创建 React Renderer
- [ ] 配置 IPC
- [ ] 配置 热更新（Hot Reload）
- [ ] 配置 Release Build

---

## Project Structure

- [ ] 创建 editor 包
- [ ] 创建 common 包
- [ ] 创建 runtime 包（空）
- [ ] 创建 compiler 包（空）
- [ ] 创建 sdk 包（空）

---

# Milestone 1 - Main Window

## Layout

目标：

```
+----------------------------------------------------+
| Menu                                               |
+--------+--------------------------+----------------+
|        |                          |                |
|        |                          |                |
|Resource|      Node Graph          | Inspector      |
|Browser |                          |                |
|        |                          |                |
+--------+--------------------------+----------------+
| Console                                           |
+----------------------------------------------------+
```

---

## Window

- [ ] 创建 Main Layout
- [ ] 创建 Menu Bar
- [ ] 创建 Dock Layout
- [ ] 创建 Status Bar

---

## Panels

### Resource Browser

- [ ] TreeView
- [ ] Search
- [ ] Context Menu
- [ ] Drag Support

---

### Story Graph

- [ ] React Flow
- [ ] 无限画布
- [ ] 缩放
- [ ] 平移
- [ ] MiniMap
- [ ] Background Grid

---

### Inspector

- [ ] Property Panel
- [ ] 自动刷新
- [ ] Property Group

---

### Console

- [ ] Log
- [ ] Warning
- [ ] Error

---

# Milestone 2 - Graph System

## Node

- [ ] Node Base
- [ ] Node Registry
- [ ] Node Factory

---

## Edge

- [ ] Connection
- [ ] Validation
- [ ] Delete

---

## Selection

- [ ] 单选
- [ ] 多选
- [ ] 框选

---

## Clipboard

- [ ] Copy
- [ ] Paste
- [ ] Duplicate

---

## Undo

- [ ] Command Pattern
- [ ] Undo
- [ ] Redo

---

# Milestone 3 - Basic Nodes

## Start Node

- [ ] Create
- [ ] Render

---

## Dialogue Node

属性：

- [ ] Character
- [ ] Text
- [ ] Audio
- [ ] Portrait

---

## Branch Node

属性：

- [ ] Dynamic Outputs
- [ ] Choice Name

---

## Return Node

属性：

- [ ] Return ID

---

## Chapter Node

属性：

- [ ] Chapter Reference
- [ ] Auto Generate Outputs

---

## Script Node

属性：

- [ ] Script ID
- [ ] Parameters

---

## Comment Node

- [ ] Resize
- [ ] Color

---

# Milestone 4 - Property System

## Property Renderer

- [ ] String
- [ ] Number
- [ ] Boolean
- [ ] Enum
- [ ] Color
- [ ] Asset Reference

---

## Inspector

- [ ] 双向绑定
- [ ] Undo 支持
- [ ] 自动刷新

---

# Milestone 5 - Resource System

## Character

- [ ] Character Asset
- [ ] Character List

---

## Audio

- [ ] Audio Asset
- [ ] Search

---

## Chapter

- [ ] Chapter List

---

## Script

- [ ] Script List

---

## Variable

- [ ] Variable List

---

# Milestone 6 - File System

## Story Asset

- [ ] New
- [ ] Open
- [ ] Save
- [ ] Save As

---

## Serialization

- [ ] Graph JSON
- [ ] Node JSON
- [ ] Resource JSON

---

## Auto Save

- [ ] Timer
- [ ] Recovery

---

# Milestone 7 - Compiler

## Graph Validation

- [ ] Dead Node
- [ ] Missing Connection
- [ ] Invalid Chapter
- [ ] Duplicate ID

---

## AST

- [ ] Build AST
- [ ] Validate AST

---

## Export

- [ ] story.json

---

# Milestone 8 - Runtime Preview

目标：

编辑器内直接运行剧情。

---

## Preview Window

- [ ] Dialogue
- [ ] Branch
- [ ] Next
- [ ] History

---

## Runtime

- [ ] Load story.json
- [ ] Execute
- [ ] Variable
- [ ] Return

---

# Milestone 9 - UX

## Search

- [ ] Search Node
- [ ] Search Dialogue
- [ ] Search Character

---

## Navigation

- [ ] Zoom To Node
- [ ] Focus Node

---

## Context Menu

- [ ] Create Node
- [ ] Delete
- [ ] Rename

---

## Shortcut

- [ ] Ctrl + S
- [ ] Ctrl + Z
- [ ] Ctrl + Shift + Z
- [ ] Ctrl + C
- [ ] Ctrl + V
- [ ] Delete
- [ ] F

---

# Milestone 10 - Polish

## UI

- [ ] Dark Theme
- [ ] Light Theme

---

## Performance

- [ ] Large Graph Test
- [ ] 1000 Nodes Test

---

## Stability

- [ ] Memory Leak Check
- [ ] Crash Recovery

---

# Future

## Plugin

- [ ] Plugin SDK
- [ ] Custom Node
- [ ] Custom Inspector
- [ ] Custom Resource

---

## AI

- [ ] AI Dialogue Generation
- [ ] AI Branch Suggestion
- [ ] AI Translation

---

## Collaboration

- [ ] Git Diff
- [ ] Merge
- [ ] Multi-user

---

## Runtime

- [ ] Unity Adapter
- [ ] Unreal Adapter
- [ ] Godot Adapter

---

# MVP Definition

项目达到 MVP 需要满足：

- [ ] Electron 应用启动
- [ ] React Flow 画布
- [ ] 创建 Dialogue Node
- [ ] 创建 Branch Node
- [ ] 创建 Return Node
- [ ] 节点连线
- [ ] Inspector 可编辑属性
- [ ] 保存 `.story`
- [ ] 打开 `.story`
- [ ] 导出 `story.json`
- [ ] Runtime Preview 可以执行简单剧情

---

# Current Goal

> **不要追求功能丰富。**

第一版只需要完成：

**一个能够创建节点、连接节点、保存、打开，并能运行一个简单对话流程的 Story Blueprint Editor。**