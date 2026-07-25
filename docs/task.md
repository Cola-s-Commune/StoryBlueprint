# Story Blueprint Editor - Task List

> Status: Planning
>
> Goal:
>
> 开发一个独立于游戏引擎的 Blueprint 风格剧情编辑器（Electron + React + TypeScript）。

---

# Milestone 0 - Project Initialization

## Repository

- [x] 初始化 Git 仓库
- [x] 配置 npm Workspace
- [x] 创建 packages 目录
- [x] 配置 TypeScript
- [x] 配置 ESLint
- [x] 配置 Prettier
- [x] 配置 EditorConfig
- [ ] 配置 Git Hooks（Husky）
- [ ] 配置 Commitlint（可选）

---

## Electron

- [x] 创建 Electron 主进程
- [x] 创建 React Renderer
- [x] 配置 IPC
- [x] 配置 热更新（Hot Reload）
- [ ] 配置 Release Build

---

## Project Structure

- [x] 创建 editor 包
- [x] 创建 common 包
- [x] 创建 runtime 包（空）
- [x] 创建 compiler 包（空）
- [x] 创建 sdk 包（空）

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

- [x] 创建 Main Layout
- [x] 创建 Menu Bar
- [x] 创建 Dock Layout
- [x] 创建 Status Bar

---

## Panels

### Resource Browser

- [ ] TreeView
- [ ] Search
- [ ] Context Menu
- [ ] Drag Support

---

### Story Graph

- [x] React Flow
- [x] 无限画布
- [x] 缩放
- [x] 平移
- [x] MiniMap
- [x] Background Grid

---

### Inspector

- [x] Property Panel
- [x] 自动刷新
- [x] Property Group

---

### Console

- [ ] Log
- [ ] Warning
- [ ] Error

---

# Milestone 2 - Graph System

## Node

- [x] Node Base
- [x] Node Registry
- [x] Node Factory

---

## Edge

- [x] Connection
- [x] Validation
- [x] Delete

---

## Selection

- [x] 单选
- [x] 多选
- [x] 框选

---

## Clipboard

- [x] Copy
- [x] Paste
- [x] Duplicate
- [x] 粘贴时重建 Node / Dynamic Port / Edge 稳定 ID

---

## Undo

- [ ] Command Pattern
- [x] Graph Snapshot Transaction
- [x] Undo
- [x] Redo

---

# Milestone 3 - Basic Nodes

## Story Entry Node（当前实现名：Start）

- [x] Create
- [x] Render
- [x] 类型 ID 统一为 `story-entry` / `end-story`，Node Definition 使用独立版本号

---

## Dialogue Node

属性：

- [x] Character（只读渲染）
- [x] Text（只读渲染）
- [ ] Speaker / Text 可编辑属性
- [ ] Voice Asset 与按语言覆盖
- [ ] Emotion / Portrait
- [ ] 稳定 Text ID

---

## Narration Node

- [ ] Text
- [ ] Voice Asset（可选）

---

## Choice Node

- [x] Render
- [ ] 动态 Option 与稳定 Option ID
- [ ] Option Text / Condition
- [ ] 每个 Option 的动态执行输出

---

## Branch Node

属性：

- [x] Render
- [ ] Boolean Expression
- [ ] 固定 True / False 输出

---

## Set Variable Node

- [ ] Variable Reference
- [ ] Typed Value Expression

---

## Call Event Node

- [ ] Event Reference
- [ ] Typed Parameters / Result
- [ ] Error Policy

---

## End Story Node

- [x] Render
- [ ] 根 Story 终止语义
- [ ] Chapter 内使用警告

---

## Return Node

属性：

- [ ] 仅在 Chapter 中创建
- [ ] 可选 Typed Return Value

---

## Chapter Node

属性：

- [ ] Chapter Reference
- [ ] Typed Input Parameters
- [ ] Completed 输出与返回值

---

## Script Node

属性：

- [ ] Script ID
- [ ] Parameters
- [ ] 延后到基础 Call Event 完成后评估

---

## Comment Node

- [ ] Resize
- [ ] Color

---

# Milestone 4 - Property System

## Property Renderer

- [x] String / Multiline String
- [ ] Number
- [ ] Boolean
- [ ] Enum
- [ ] Color
- [ ] Asset Reference

---

## Inspector

- [x] 双向绑定
- [x] Undo 支持
- [x] 自动刷新
- [x] Node Name / Type / Stable ID
- [x] Start / Dialogue / Choice / Branch / End 基础属性

---

# Milestone 5 - Resource System

## Character

- [ ] Character Asset
- [ ] Character List
- [ ] 稳定 ID / Name / Display Name
- [ ] Emotion / Portrait 配置

---

## Audio

- [ ] Audio Asset
- [ ] Search
- [ ] Locale Voice Mapping

---

## Chapter

- [ ] Chapter List
- [ ] Parameter / Local Variable / Return Type

---

## Script

- [ ] Script List

---

## Variable

- [ ] Variable List
- [ ] Project / Story / Chapter / Character Scope
- [ ] Boolean / Number / String / Enum / Struct / Nullable
- [ ] 引用检查与安全重命名

---

## Localization

- [ ] 内联默认文本与稳定 Text ID
- [ ] 本地化表提取
- [ ] Locale Fallback

---

# Milestone 6 - File System

## Story Asset

- [x] New
- [x] Open
- [x] Save
- [x] Save As

---

## Serialization

- [x] 定义版本化 `.story` KDL Schema（当前五种基础节点）
- [x] 定义版本化 Node Definition Schema
- [x] `.story` Parse / Serialize
- [x] 稳定格式化（确保 Git Diff 可读）
- [ ] 注释与未知字段保留测试
- [x] Typed Story Graph 内存模型
- [ ] 静态端口派生、动态端口项序列化
- [ ] Character / Variable / Asset 引用序列化
- [x] 稳定 ID / Name / Display Name 模型
- [ ] 格式版本迁移

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
- [ ] 悬空 Node / Port / Resource 引用
- [ ] Entry / End / Return 上下文与终结路径
- [ ] Chapter 参数和返回值类型
- [ ] 无等待点的紧密死循环

---

## AST

- [ ] Build AST
- [ ] Validate AST
- [ ] Graph → Story AST
- [ ] Story AST → Runtime Program
- [ ] 表达式字符串 → Typed Expression AST
- [ ] 表达式稳定符号绑定与安全重命名
- [ ] 移除坐标、端口、边和编辑器元数据
- [x] Block 终结指令与显式 Jump 校验
- [ ] 可选 Source Map

---

## Export

- [ ] 导出 `.storyc.json`
- [x] 定义版本化 Runtime Program Schema
- [ ] Compiler Backend 接口
- [ ] 暂不实现自定义字节码
- [ ] 暂不生成 TypeScript 剧情代码

---

# Milestone 8 - Runtime Preview

目标：

编辑器内直接运行剧情。

---

## Preview Window

- [ ] Dialogue
- [ ] Choice
- [ ] Branch / Condition
- [ ] Next
- [ ] History

---

## Runtime

- [ ] Load `.storyc.json`
- [x] RuntimeState / CallFrame / PendingInteraction 类型契约
- [ ] `blockId + instructionIndex` 执行状态机
- [ ] Async Pause / Resume / Abort
- [ ] Project / Story / Chapter / Character Variables
- [ ] Call Stack / Return Value
- [ ] End Story
- [ ] 稳定点 Save / Load
- [ ] Pending Choice / Event 恢复
- [ ] Program Version 兼容性检查
- [ ] 结构化 Runtime Diagnostics

---

## Engine Adapter

- [x] StoryAdapter TypeScript 契约
- [x] Dialogue / Choice 异步接口
- [ ] Event Registry 与 Typed Parameters / Result
- [ ] Text / Voice / Asset 解析
- [ ] External Variable 读写
- [ ] AbortSignal 取消
- [ ] Adapter 返回值校验与错误策略

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

- [x] Create Node
- [ ] Delete
- [ ] Rename

---

## Shortcut

- [x] Ctrl + N
- [x] Ctrl + O
- [x] Ctrl + S
- [x] Ctrl + Shift + S
- [x] Ctrl + Z
- [x] Ctrl + Shift + Z
- [x] Ctrl + C
- [x] Ctrl + V
- [x] Delete
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

# Milestone 11 - AI Editing Foundation

目标：

AI 通过稳定的语义模型和命令协议编辑蓝图，不直接操作画布，也不绕过校验直接修改内部状态。

## Semantic Model

- [ ] 为 Story / Chapter / Node / Port / Resource 定义稳定 ID
- [ ] Typed Story Graph Schema
- [ ] 面向 AI 的精简语义视图（不包含坐标和 UI 状态）
- [ ] 按 Chapter / Subgraph 构建局部上下文
- [ ] Revision / Conflict Detection

---

## Blueprint Command API

- [ ] Command Schema Version / Operation ID
- [ ] Add / Update / Remove Node
- [ ] Connect / Disconnect
- [ ] Add / Update Character
- [ ] Add / Update Variable
- [ ] Set Expression
- [ ] Create / Refactor Chapter
- [ ] Import / Export Ink
- [ ] Validate / Auto Layout
- [ ] 通用原语与高级命令展开

---

## Safe Editing

- [ ] JSON Schema 校验 AI 命令
- [ ] 端口与数据类型校验
- [ ] 批量 Transaction
- [ ] Dry Run / Preconditions / Atomic Rollback
- [ ] 与 Undo / Redo 集成
- [ ] 语义 Diff / 布局 Diff 分离
- [ ] 高风险操作执行前 Diff Preview
- [ ] 低风险局部操作自动执行策略
- [ ] 高亮 AI 新增、修改和删除内容
- [ ] 失败时返回结构化 Diagnostics
- [ ] 删除与改型前引用检查
- [ ] Operation ID 去重

---

# Milestone 12 - Ink Interoperability

## Versioned Ink Profile

- [ ] 定义受支持的 Story Blueprint Ink 子集
- [ ] Speaker / Voice / Emotion / Text ID Tag 规范
- [ ] Tag 转义与稳定 ID 规则
- [ ] Ink Variable 与 Typed Variable 映射

---

## Import / Export

- [ ] `.story` → `.ink` 语义导出
- [ ] 受支持 `.ink` → Typed Story Graph
- [ ] 不受支持结构的 Diagnostics / Preview
- [ ] 任意 Ink 降级为保留原文的 Ink Block
- [ ] 语义往返测试

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
- [ ] AI Logic Validation
- [ ] AI Ink Conversion
- [ ] AI Chapter Refactoring
- [ ] AI Character / Voice / Emotion Completion

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
- [ ] 创建 End Story Node
- [ ] 节点连线
- [ ] Inspector 可编辑属性
- [x] 保存 `.story`
- [x] 打开 `.story`
- [ ] 导出 `.storyc.json`
- [ ] Runtime Preview 可以执行简单剧情

---

# Current Goal

> **不要追求功能丰富。**

第一版只需要完成：

**一个能够创建节点、连接节点、保存、打开，并能运行一个简单对话流程的 Story Blueprint Editor。**
