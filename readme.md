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

项目规范与设计文档：

- [编辑器撤销与重做规范](docs/editor-undo-redo-spec.md)
- [Story 系统设计](docs/story-system-design.md)
- [开发任务](docs/task.md)

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

MVP 与核心编辑器、Compiler、Runtime Preview、Ink Block 互操作、Git 合并工作流及 Windows 发布链路已完成。当前下一阶段是 Unity Adapter：将版本化 `.storyc.json` 接入独立 C# Runtime，并提供 Unity 对话/选项 UI 桥接和可运行示例。

项目进度和规划：

- [开发任务与完成状态](docs/task.md)
- [npm 命令速查（开发、测试、构建、发布与部署）](docs/npm-commands.md)
- [Unity Adapter 实施计划](docs/unity-adapter-plan.md)
- [StoryAdapter 运行时契约](docs/story-adapter-specification.md)
- [Ink 互操作范围](docs/ink-profile.md)

---

命令行开发、构建、测试、发布和部署步骤见 [npm 命令速查](docs/npm-commands.md)。

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
