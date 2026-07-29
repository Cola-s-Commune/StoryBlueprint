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
- [x] 画布可选择并记住 Blueprint / Standard 操作模式；Blueprint 左键框选、右键平移，Standard 左键平移、Shift+左键框选
- [x] Shift+框选追加已有选择；多选外框上的右键拖动继续平移画布
- [x] 多选外框内 Ctrl+左键切换单个节点及其相关内部连线选择

---

### Inspector

- [x] Property Panel
- [x] 自动刷新
- [x] Property Group
- [x] Set Variable 的 String 值区分普通文本与表达式，普通文本无需手写引号

---

### Console

- [ ] Log
- [ ] Warning
- [ ] Error
- [x] Problems、运行预览、工作区、画布和状态栏中的错误文本可选择并复制
- [x] Problems 支持一次复制全部结构化诊断与 Story / 文件 / Substory / Node 定位

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
- [x] 双击连线插入 Reroute，右键连线可选择插入 Reroute 或转换为 Flow Portal
- [x] 同一 Graph 内的 Flow Jump / Flow Anchor 以稳定 Node ID 配对，选中任一端时显示虚拟跳转线
- [x] Reroute 与 Flow Anchor 在编译时消除，Flow Jump 降级为普通 Runtime Jump
- [x] 单后继执行输出重新连线时直接替换旧连线
- [x] UE 风格 Pin 快捷操作：Alt+左键断开全部连线，Ctrl+左键拖动整体转移连线
- [x] Pin 使用放大的透明拉线热区和十字准星；节点使用四向移动光标；Reroute 外圈移动、内圈拉线
- [x] Alt+左键点击连线，断开被点击的单条连线
- [x] 画布内 Graph Shortcuts 帮助面板

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
- [x] Voice / Portrait 资源选择器与按语言覆盖
- [x] 稳定 Text ID
- [x] Dialogue 改为可排序的多 Line 连续对话段，每句使用稳定 Line ID / Text ID
- [x] 连续 Dialogue 节点可合并；Inspector 可勾选 Line 并按原顺序拆成 Dialogue 链
- [x] 删除 Dialogue 节点级 Speaker / Emotion / Voice，所有对话属性只属于 Line
- [x] Line 支持 Speaker、Text Template、Emotion、Voice、Tags
- [x] Inspector 支持新增、删除、复制和拖动排序 Line
- [x] Line 属性卡默认折叠为“说话人 + 台词”摘要，可独立展开并直接定位到对应 Ink 行
- [x] Inspector 提供 Monaco `Lines / Ink` 双视图，结构化编辑后即时重建 Dialogue Ink 文本
- [x] Dialogue Ink 子集支持批量编辑、资源名称解析、行级诊断、自动写回/撤销和稳定 ID 对齐
- [x] Dialogue Ink 使用 `Character: text` 剧本前缀；拒绝行尾 `# speaker`，不兼容早期试验格式
- [x] Monaco Ink 编辑器支持 80%–200% 字号缩放、快捷键复位和可切换的大高度编辑区
- [x] Monaco `Ctrl+S / Ctrl+Shift+S` 先原子应用有效 Ink 草稿，再保存 Story / Save As
- [x] 离开 Monaco Ink 视图时自动写回 Lines 并保存 Story，移除独立 Apply 操作
- [x] Ink 编辑会话在进入时捕获蓝图快照，离开后的自动应用可通过一次 `Ctrl+Z` 完整撤销
- [x] Dialogue Ink 中每个物理行对应一个 Line，保留空 Line，并转义换行、反斜杠和 Ink Tag 起始符
- [x] 画布节点折叠展示前几句与总句数，避免长对话撑高蓝图
- [x] Compiler 将多个 Line 降级为连续 Dialogue 指令，控制流仍只从节点末尾离开
- [x] Runtime 历史、语音播放和恢复位置精确到单个 Line
- [x] Line 之间出现 Choice、Branch、Event 或变量修改时保持为独立节点

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
- [x] Option 卡片采用与 Dialogue Line 一致的折叠摘要、拖动排序、新增、复制、删除与行级 Ink 定位
- [x] Choice Monaco 双向编辑 Prompt 与 `* Option`，条件标签可往返，离开时自动保存且可整体撤销
- [x] 删除 Option 时同步清理对应输出连线，Undo 恢复 Option 与连线

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

- [x] 项目级 Event Definition / Registry 与稳定 Event ID
- [x] 面向程序员的 Event Interface Table 展示名称、参数签名、稳定 ID 与 Description，可复制 Markdown
- [x] Event Name / Display Name、参数 Schema 与 Description
- [x] Event Reference 使用稳定 ID，参数重命名同步更新已打开 Story 的节点绑定
- [x] 第一阶段 Boolean / Number / String 参数及 Literal / Expression / Variable 表达式绑定
- [x] Call Event 固定为派发后立即继续；无返回值、完成状态或失败分支
- [ ] Boolean / Number / String / CharacterRef / AssetRef 参数
- [ ] Array / Struct / Map / Json 递归复杂参数，编译产物使用 JSON 兼容值
- [ ] 参数支持 Literal、Expression、Variable Binding 和结构化编辑
- [ ] Raw JSON 仅作为复杂参数的逃生编辑方式
- [ ] Ink External Function 映射为 Event Definition / Call Event

## Wait for Signal Node

- [x] 项目级 Signal Definition、稳定 Signal ID、Display Name、Description 与类型化参数 Schema
- [x] Signal 与 Event 合并为可复制 Markdown 的程序员接口表
- [x] Wait for Signal 节点、KDL、Compiler、Runtime 与 Preview 闭环
- [x] RuntimeState 序列化提前到达的 Signal Payload 队列；Wait 节点消费第一条匹配项
- [x] Pending Signal 可保存、恢复和通过 AbortSignal 取消 Adapter 等待
- [x] Boolean / Number / String Signal Payload；Wait 参数可逐项选择 Any 或 Match Expression
- [x] Match Expression 到达 Wait 时求值并进入 PendingInteraction；未匹配 Payload 继续缓存
- [ ] CharacterRef / AssetRef 与复杂 JSON Payload；首版不做对象深度相等匹配

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

## Ink Block Node

- [ ] Embedded Ink：完整 Ink 文本保存在 `.story` 中
- [ ] Linked Ink：引用项目内 `.ink` 文件，外部文件作为权威来源
- [ ] 接入完整 Ink Runtime，不要求先转换成原生节点
- [ ] Ink Block 的入口、完成出口、变量桥接与 Event Adapter 桥接
- [ ] Ink Runtime 暂停、选择、继续、错误和取消状态接入 Story Runtime
- [ ] Linked / Embedded 模式明确单一权威来源，不自动双向同步文本与节点
- [ ] Convert to Nodes / Convert to Ink Block 使用显式操作和 Diff Preview

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
- [x] Character Name 修改时同步 Display Name，独立资源文件路径保持稳定
- [x] Emotion 名称配置
- [x] Portrait 资源选择器

---

## Audio

- [x] Story Data Asset List 与 Voice / Portrait / Other 类型
- [x] Dialogue Voice Asset 引用
- [x] Search
- [x] Locale Voice Mapping

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
- [x] 变量、角色与资产详细编辑统一显示在右侧 Inspector
- [x] 资源 Name 使用草稿提交，允许暂时清空，空值确认时恢复原名
- [x] Variable Name 确认修改时同步 Display Name
- [x] Story / Chapter / Local Scope
- [x] Boolean / Number / String
- [ ] Project / Character 外部 Scope
- [ ] Enum / Struct / Nullable
- [ ] 引用检查与安全重命名

---

## Localization

- [x] 内联默认文本与稳定 Text ID
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
- [x] 新建项目自动创建并打开默认 Main Story
- [x] 项目级共享角色与资产独立资源文件
- [x] 独立资源的稳定 ID、重复定义与悬空引用校验
- [x] `.story` KDL 允许引用项目级角色和资产，存在性由项目同步与 Compiler 校验
- [x] 删除角色或资产前执行跨 Story 与肖像引用检查
- [x] 角色删除统一使用可取消的原生确认流程
- [x] 未保存 Story 按实际资源引用阻止删除，不再因全局 dirty 状态误拦截
- [x] 项目、Story、角色与资产支持删除和在文件管理器中显示

---

## Serialization

- [x] 定义版本化 `.story` KDL Schema
- [x] 定义版本化 Node Definition Schema
- [x] `.story` Parse / Serialize
- [x] 稳定格式化（确保 Git Diff 可读）
- [ ] 注释与未知字段保留测试
- [x] Typed Story Graph 内存模型
- [ ] 静态端口派生、动态端口项序列化
- [x] Character / Variable / Asset 引用序列化
- [x] Substory Graph、Call Substory 与 Return 序列化
- [x] Reroute、Flow Jump 与 Flow Anchor 序列化和引用校验
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
- [x] Flow Jump 同图 Anchor 引用、虚拟可达性与循环分析

---

## AST

- [ ] Build AST
- [ ] Validate AST
- [x] Typed Story Graph → Runtime Program
- [x] 表达式字符串 → Typed Expression AST
- [ ] 表达式稳定符号绑定与安全重命名
- [x] 移除坐标、端口、边和编辑器节点 ID
- [x] Block 终结指令与显式 Jump 校验
- [x] Reroute / Flow Portal 控制流降级，不把视觉路由节点写入 Runtime Program
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
- [x] 一键复制编译和运行错误
- [x] Runtime State 单槽保存、加载与复制 JSON；不兼容内容版本显示结构化错误

---

## Runtime

- [x] Load `.storyc.json`
- [x] RuntimeState / CallFrame / PendingInteraction 类型契约
- [x] `blockId + instructionIndex` 执行状态机
- [x] Async Pause / Resume / Abort
- [x] 多 Line Dialogue 的逐句暂停、继续、历史和恢复位置
- [x] Typed Expression 求值、Text Template 渲染和 Choice 条件过滤
- [x] Story Variable 默认值、读取与 Set Variable 集成
- [ ] Project / Story / Chapter / Character Variables 状态机集成
- [ ] Typed Return Value
- [x] 无返回值 Substory Call Stack / Return
- [x] End Story
- [x] 稳定点 Save / Load（Preview 本地槽验证 RuntimeState 契约）
- [x] Pending Dialogue / Choice / Signal 与 Signal Inbox JSON 往返恢复
- [ ] Ink Block 子运行时的暂停、选择、恢复与终止
- [x] Program Format / Version / Content Version 检查
- [x] 核心执行状态机结构化 Runtime Diagnostics

---

## Engine Adapter

- [x] StoryAdapter TypeScript 契约
- [x] Dialogue / Choice 异步接口
- [ ] Event Registry 与 Typed Parameters / Result
- [x] `callEvent(eventId, arguments, signal)` 异步调用协议
- [x] 游戏引擎按稳定 Event ID 注册具体 Handler
- [ ] Wait / Fire-and-forget、返回值与 Failed 分支语义
- [ ] Text / Voice / Asset 解析
- [ ] External Variable 读写
- [x] AbortSignal 取消
- [ ] Adapter 返回值校验与错误策略

---

# Milestone 9 - UX

## Search

- [x] Search Node
- [x] Search Dialogue
- [x] Search Character / Variable / Asset / Event / Signal

---

## Navigation

- [x] Zoom To Node
- [x] Focus Node（包含跨 Main Story / Substory 切换）

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
- [x] Ctrl + Plus / Minus / 0 全窗口缩放与 View 菜单操作
- [x] Ctrl + C
- [x] Ctrl + V
- [x] Ctrl + F 当前 Story 搜索
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

- [x] 为 Story / Chapter / Node / Port / Resource 定义稳定 ID
- [x] Typed Story Graph Schema
- [x] 面向 AI 的精简语义视图（不包含坐标、Definition Version 和 UI 状态）
- [x] AI Snapshot / Revision 使用项目解析后的角色、资产、事件和信号视图
- [x] 按选中节点 / 当前 Graph / 整个 Story 构建上下文（选中范围包含一跳边界节点）
- [x] 确定性 Semantic Revision / Conflict Detection

---

## Blueprint Command API

- [x] Command Format / Version / Transaction 内 Operation ID
- [x] Add / Update / Remove Node 原语
- [x] Connect / Disconnect 与显式 Replace Existing
- [ ] Add / Update Character
- [x] Add / Update Variable
- [x] Set Expression（Branch、Set Variable、Choice 条件、Event 参数与 Signal Match）
- [x] Add / Update / Remove Dialogue Line
- [x] Add / Update / Remove Choice Option
- [ ] Create / Refactor Chapter
- [ ] Import / Export Ink
- [ ] 显式 Validate / Auto Layout 命令
- [ ] 通用原语与高级命令展开

---

## Safe Editing

- [x] AI Commands 面板：复制上下文 / Snapshot、粘贴事务、Dry Run、语义 Diff、Apply
- [x] 导出 Blueprint Command Draft 2020-12 JSON Schema
- [x] Runtime 形状校验与 Schema 同步拒绝未知顶层、Operation 和 add-node 字段
- [x] 端口、数据类型、Source Schema 与 Editor Compiler 校验
- [x] 项目级共享资源引用参与 AI Dry Run / Compiler 校验，但不回写进 Story Source
- [x] 批量 Transaction
- [x] Dry Run / Revision Precondition / Atomic Rollback
- [x] 单个活动 Graph + Story Variable 事务与 Undo / Redo 集成
- [ ] 跨 Graph / Chapter 原子历史快照与 Undo / Redo
- [x] 第一版语义 Diff 不包含坐标或布局变化
- [x] 所有面板操作执行前强制 Dry Run / Diff Preview
- [ ] 低风险局部操作自动执行策略
- [x] Dry Run 显示字段级语义 Diff 与删除摘要
- [x] Dry Run 后以独立 Proposal Graph 高亮并聚焦 AI 新增、修改节点
- [x] AI 新增节点连接感知自动布局且可在暂存态移动，不移动已有节点
- [x] 画布支持从左到右整理选中节点、整个 Graph 或 AI Proposal；正式布局进入 Undo
- [x] 画布与 AI 面板提供 Apply / Discard；Apply 时原子提交预览坐标
- [x] 空白点击、移动预览节点或等待不会隐式 Apply
- [x] 失败时返回 Operation ID / Index / Path 结构化 Diagnostics
- [x] Copy Retry Context：携带错误、原响应、Schema、节点目录和最新 Snapshot
- [ ] 删除与改型前引用检查
- [x] Transaction 内 Operation ID 去重
- [ ] 跨请求 Operation ID 幂等记录
- [x] 内置 OpenAI-compatible Provider、系统安全凭据、取消 / 诊断重试与生成后自动 Dry Run
- [x] Provider 思考模式与会话级 reasoning 展示（默认折叠、可复制、不进入项目数据）
- [x] 会话式 Story Assistant：理解最新 Story 状态、回答 / 追问、可选命令提案与会话隔离
- [x] Codex 风格 chat-first 交互：底部 Composer、键盘发送、自动滚动、上下文与工作状态、提案审核卡片
- [x] 按 Workspace + Story 持久化 AI 会话，支持历史切换、新建和删除，不污染项目文件
- [ ] 流式命令生成与更多 Provider Adapter

---

# Milestone 12 - Ink Interoperability

完整运行 Ink Block 与 Ink 节点化是两条可共存路线。近期优先保证任意 Ink 可以作为
Linked 或 Embedded Ink Block 运行；完整节点转换不阻塞这一能力，并作为后续渐进目标。

## Ink Block Runtime

- [ ] 集成 Ink Runtime，执行完整 Ink 语言而非仅支持子集
- [ ] Linked `.ink` 与 Embedded Ink Source 加载、编译和诊断
- [ ] Ink Variable 与 Story Typed Variable 显式桥接
- [ ] Ink External Function 与项目 Event Definition 映射
- [ ] Ink Choice / Continue 与 Story Runtime PendingInteraction 桥接
- [ ] Ink Block 运行状态参与 Save / Load、Abort 和结构化 Diagnostics

---

## Versioned Ink Profile

- [ ] 定义可转换为原生节点的版本化 Ink Profile
- [ ] 建立完整 Ink 语法与原生节点类型的覆盖矩阵
- [ ] Speaker / Voice / Emotion / Text ID Tag 规范
- [ ] Tag 转义与稳定 ID 规则
- [ ] Ink Variable 与 Typed Variable 映射
- [ ] 连续 Ink 台词合并为多 Line Dialogue，控制流边界处自动拆分
- [ ] Expressions 保持内嵌，不把普通运算展开成大量数据节点

---

## Import / Export

- [ ] `.story` → `.ink` 语义导出
- [ ] 受支持 `.ink` → Typed Story Graph
- [ ] 完整 `.ink` → 原生节点的长期转换目标
- [ ] 暂未覆盖的结构保留为可完整运行的 Ink Block，并提供 Diagnostics / Preview
- [ ] Linked / Embedded Ink Block → Nodes 显式转换
- [ ] 选中原生节点 → Ink Block 显式转换
- [ ] 转换前显示语义 Diff，不承诺保留原始空白、排版和注释位置
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

- [x] 两个合法 `.story` 文件按稳定 ID 做字段级语义 Diff
- [x] Story Merge 面板逐项选择 Local / Remote，批量选择、编译校验并作为单次 Undo 应用
- [ ] Git 冲突标记检测与 Base / Local / Remote 三方合并
- [ ] 项目级 Character / Asset / Event / Signal 资源冲突合并
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
