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
- [x] 启动时显示项目/文件欢迎页，不自动创建 Untitled Story
- [x] 支持原生新建、打开与保存项目
- [x] 关闭、退出及切换项目时提供 Save / Don't Save / Cancel 未保存保护
- [x] 成功切换项目后清理旧项目的 Story 标签和编辑状态
- [x] 持久化最近项目，并支持从欢迎页重新打开或移除

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

### Docking / Floating

- [x] Inspector 默认宽度 420px、最小宽度 360px，可调整至 720px
- [x] Resource Browser / Story Graph / Inspector / Console 使用 Dockview，支持拖拽分组、调整尺寸和应用内浮动
- [x] Story Data 默认停靠在左下，可独立拖拽、关闭、恢复和浮动
- [x] 面板标签右键支持显式 Float / Dock，View 菜单可恢复已关闭面板
- [x] 保存和恢复面板尺寸、停靠状态与浮动窗口位置
- [x] View → Reset Layout 恢复默认布局
- [ ] 评估 Story Graph 多窗口视图

### Resource Browser

- [x] 同一编辑工作区管理多个独立 Story 资源
- [x] Story → Main Story / Substory 分层资源树
- [x] 新建、打开、切换、重命名和关闭 Story
- [x] 每个 Story 独立保留图、变量、角色、资源与未保存状态
- [x] VS Code 风格 Open Stories + Explorer 双层资源管理
- [x] 选择真实工作目录并递归展示子文件夹与 `.story` 文件
- [x] 在选中目录中新建文件夹和 Story
- [x] Story 内 Main Story / Substory 蓝图列表
- [x] 新建、重命名、切换和安全删除 Substory
- [x] 多选节点提取为单入口、单出口 Substory
- [x] 文件系统 TreeView
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

- [x] Character 稳定引用与下拉选择
- [x] 变量化 Text Template 编辑与画布渲染
- [x] Speaker / Text 可编辑属性
- [x] Voice Asset ID 基础字段
- [x] Character Emotion 选择
- [ ] Voice / Portrait 资源选择器与按语言覆盖
- [ ] 稳定 Text ID

---

## Narration Node

- [ ] Text
- [ ] Voice Asset（可选）

---

## Choice Node

- [x] Render
- [x] 动态 Option 与稳定 Option ID
- [x] Option Text Template / Visible If / Enabled If
- [x] 每个 Option 的动态执行输出

---

## Branch Node

属性：

- [x] Render
- [x] Boolean Expression 文本编辑与变量拖入
- [x] 固定 True / False 输出

---

## Set Variable Node

- [x] Variable Reference
- [x] Typed Value Expression

## Get Variable Node

- [x] Variable Reference
- [x] Typed Data Output Pin

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

- [x] 仅在 Substory 中创建
- [ ] 可选 Typed Return Value

---

## Chapter Node

属性：

- [x] Substory 稳定引用与下拉选择
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

- [x] Story Data Character List
- [x] 稳定 ID / Name / Display Name
- [x] Emotion 名称配置
- [ ] Portrait 资源选择器

---

## Audio

- [x] Story Data Asset List 与 Voice / Portrait / Other 类型
- [x] Dialogue Voice Asset 引用
- [ ] Search
- [ ] Locale Voice Mapping

---

## Chapter

- [x] Substory / Chapter List
- [ ] Parameter / Local Variable / Return Type

---

## Script

- [ ] Script List

---

## Variable

- [x] Story Data Variable List
- [x] Story / Chapter / Local Scope
- [x] Boolean / Number / String
- [ ] Project / Character 外部 Scope
- [ ] Enum / Struct / Nullable
- [ ] 引用检查与安全重命名

---

## Localization

- [ ] 内联默认文本与稳定 Text ID
- [ ] 本地化表提取
- [ ] Locale Fallback

---

# Milestone 6 - File System

## Story Asset

- [x] 启动进入空会话，不自动创建 Untitled Story
- [x] 欢迎页提供 New Project / Open Project / Open Story
- [x] 关闭最后一个 Story 后返回空会话
- [x] New
- [x] Open
- [x] Save
- [x] Save As
- [x] 多 Story 同时打开与分别保存
- [x] 工作目录选择、刷新和目录内 Story 打开
- [x] 所有目录 IPC 执行工作区边界校验
- [x] Save All
- [x] 工作目录与 Open Stories 会话恢复
- [x] 版本化 `.storyproject` 项目清单
- [x] 项目级 Story 路径、角色与资产使用索引
- [x] 创建与手动同步项目索引，保存/新增 Story 后自动同步
- [x] 原生文件对话框新建、打开和保存项目
- [ ] 项目级共享角色与资产独立资源文件

---

## Serialization

- [x] 定义版本化 `.story` KDL Schema（当前五种基础节点）
- [x] 定义版本化 Node Definition Schema
- [x] `.story` Parse / Serialize
- [x] 稳定格式化（确保 Git Diff 可读）
- [ ] 注释与未知字段保留测试
- [x] Typed Story Graph 内存模型
- [ ] 静态端口派生、动态端口项序列化
- [x] Character / Variable / Asset 引用序列化
- [x] Substory Graph、Call Substory 与 Return 序列化
- [x] 稳定 ID / Name / Display Name 模型
- [x] v2 紧凑格式：短 ID、可选 Node Name、无 Edge ID、默认端口/版本省略、整数坐标
- [x] 明确放弃旧格式兼容与迁移

---

## Auto Save

- [x] 定时写入独立恢复快照（不覆盖源 `.story`）
- [x] 异常退出后启动恢复或丢弃

---

# Milestone 7 - Compiler

## Graph Validation

- [x] Dead / Unreachable Node
- [x] Missing Connection
- [x] Invalid Chapter
- [x] Duplicate ID（源文件与项目解析阶段）
- [x] 悬空 Node / Port 引用
- [ ] 悬空 Character / Asset 引用
- [x] Entry / End / Return 上下文与终结路径
- [ ] Chapter 参数和返回值类型
- [x] 根蓝图与 Substory 编译、Call / Return 降级
- [x] 无等待点的紧密死循环

---

## AST

- [ ] Build AST
- [ ] Validate AST
- [x] Typed Story Graph → Runtime Program
- [x] 表达式字符串 → Typed Expression AST
- [ ] 表达式稳定符号绑定与安全重命名
- [x] 移除坐标、端口、边和编辑器节点 ID
- [x] Block 终结指令与显式 Jump 校验
- [ ] 可选 Source Map

---

## Export

- [x] 导出项目级 `.storyc.json`
- [x] Problems 面板与 Story / Substory / Node 定位
- [x] 项目默认入口 Story 与编译输出目录
- [x] 定义版本化 Runtime Program Schema
- [x] Compiler Backend 接口与默认实现
- [ ] 暂不实现自定义字节码
- [ ] 暂不生成 TypeScript 剧情代码

---

# Milestone 8 - Runtime Preview

目标：

编辑器内直接运行剧情。

---

## Preview Window

- [x] Dialogue
- [x] Choice
- [x] Branch / Condition
- [x] Next
- [x] History
- [x] 当前变量与执行位置查看
- [x] 编译和运行错误展示

---

## Runtime

- [x] Load `.storyc.json`
- [x] RuntimeState / CallFrame / PendingInteraction 类型契约
- [x] `blockId + instructionIndex` 执行状态机
- [ ] Async Pause / Resume / Abort
- [x] Typed Expression 求值、Text Template 渲染和 Choice 条件过滤
- [x] Story Variable 默认值、读取与 Set Variable 集成
- [ ] Project / Story / Chapter / Character Variables 状态机集成
- [ ] Typed Return Value
- [x] 无返回值 Substory Call Stack / Return
- [x] End Story
- [ ] 稳定点 Save / Load
- [ ] Pending Choice / Event 恢复
- [x] Program Format / Version / Content Version 检查
- [x] 核心执行状态机结构化 Runtime Diagnostics

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

- [x] Electron 应用启动
- [x] React Flow 画布
- [x] 创建 Dialogue Node
- [x] 创建 Branch Node
- [x] 创建 End Story Node
- [x] 节点连线
- [x] Inspector 可编辑属性
- [x] 保存 `.story`
- [x] 打开 `.story`
- [x] 导出 `.storyc.json`
- [x] Runtime Preview 可以执行简单剧情

---

# Current Goal

> **不要追求功能丰富。**

第一版只需要完成：

**一个能够创建节点、连接节点、保存、打开，并能运行一个简单对话流程的 Story Blueprint Editor。**
