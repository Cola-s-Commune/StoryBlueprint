# Story Blueprint

> A cross-engine visual narrative framework for games.

Story Blueprint 是一个**独立于游戏引擎**的可视化剧情/任务编辑框架。

它的目标不是替代 Unreal Engine、Unity 或 Godot，而是为这些引擎提供一套统一的**剧情（Story）**、**任务（Quest）**、**事件（Event）**、**流程（Flow）**开发方案。

---

# Vision

游戏引擎负责：

- Rendering
- Physics
- Animation
- Audio
- Networking

Story Blueprint 负责：

- Story
- Dialogue
- Quest
- Event
- Branch
- Variables
- Cutscene Flow

通过 Runtime Adapter，使同一套剧情资源可以运行于不同游戏引擎。

```
Story Blueprint Editor
          │
      Story Asset
          │
      Story Runtime
          │
    Engine Adapter
     ├── Unity
     ├── Unreal
     └── Godot
```

---

# Design Principles

## Engine Independent

编辑器不属于任何游戏引擎。

Runtime 不依赖任何游戏引擎。

Adapter 负责连接 Runtime 与引擎。

---

## Data Driven

所有剧情均采用数据驱动。

Editor 只负责生成数据。

Runtime 负责执行数据。

Engine 负责表现数据。

---

## Visual First

采用 Blueprint 风格编辑。

不是脚本编辑器。

不是 Word。

而是面向游戏开发者的可视化流程编辑器。

---

## Plugin Friendly

所有节点均可扩展。

支持：

- 自定义 Node
- 自定义 Resource
- 自定义 Compiler
- 自定义 Runtime
- 自定义 Exporter

---

## Cross Engine

设计目标：

- Unity
- Unreal Engine
- Godot

未来可扩展到更多运行环境。

---

# Project Structure

```
StoryBlueprint/

docs/

packages/

editor/

runtime/

compiler/

common/

sdk/

examples/
```

---

# Modules

## Story Editor

Electron + React

负责：

- Node Graph
- Property Panel
- Resource Browser
- Serialization

---

## Story Compiler

负责：

Graph

↓

AST

↓

Story Asset

↓

JSON

---

## Story Runtime

纯 TypeScript Runtime。

负责：

- Dialogue
- Chapter
- Branch
- Variables
- Call Stack
- Save / Load

不负责：

- UI
- Audio
- Rendering
- Animation

---

## Engine Adapter

负责：

Runtime 与游戏引擎通信。

例如：

```
DialogueNode

↓

ShowDialogue()

↓

Unity UI
```

---

# Current Status

Project Status：

🚧 Milestone 2 — Graph System / Edge

当前阶段：

- [x] Overall Architecture
- [x] Editor (骨架：Electron + React + Dock 布局)
- [x] Editor (画布：React Flow 节点图)
- [x] Node Registry / Node Factory
- [x] Start / Dialogue / Choice / Branch / End 节点渲染
- [ ] Edge 校验与完整管理
- [ ] Runtime
- [ ] Compiler
- [ ] Plugin SDK
- [ ] Unity Adapter
- [ ] Unreal Adapter
- [ ] Godot Adapter

> 详细进度见 `docs/devlog.md` 和 `docs/task.md`

---

# Windows Release

发布环境需要 Node.js 22.12 或更高版本。

```powershell
# 可直接运行的目录版本
npm run release:win:dir

# 单文件 portable 版本
npm run release:win:portable

# 可选择安装目录、创建桌面/开始菜单快捷方式的安装包
npm run release:win:installer

# 同时生成安装包和 portable 版本
npm run release:win

# 隐藏启动两个发行版本，验证 ASAR、preload 和 renderer
npm run verify:release:win
```

发行产物写入 `release/`。当前版本包含自定义应用图标、Windows 安装器和 portable 版本；尚未配置代码签名或自动更新。

---

# Long-term Roadmap

## Phase 1

Story Editor MVP

- Dialogue Node
- Branch Node
- Return Node
- JSON Export

---

## Phase 2

Story Runtime

- Chapter
- Variables
- Save / Load

---

## Phase 3

Unity Integration

---

## Phase 4

Unreal Integration

---

## Phase 5

Plugin SDK

---

## Phase 6

Community Ecosystem

---

# Philosophy

Story Blueprint 并不是一个 Galgame 编辑器。

它希望成为：

> A Blueprint-style Gameplay Flow Framework.

任何需要：

- Dialogue
- Quest
- Tutorial
- Cutscene
- NPC Conversation
- Mission Flow

都可以建立在 Story Blueprint 之上。

---

# License

License 未确定。

计划采用开放源代码协议，并保持项目长期开放发展。

---

# Contributing

目前项目仍处于架构设计阶段。

欢迎讨论：

- Runtime
- Compiler
- Editor
- Plugin System
- Cross-engine Design

---

# Author

Created by Father Your.
