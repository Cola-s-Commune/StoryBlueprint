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
- [x] 配置 Windows x64 Release Build：ASAR、unpacked、portable 与隐藏启动 smoke test
- [x] 配置应用图标、EXE 元数据、NSIS 安装器、快捷方式与 About 信息
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
| Runtime Preview / Problems / AI Commands          |
+----------------------------------------------------+
```

---

## Window

- [x] 创建 Main Layout
- [x] 创建 Menu Bar
- [x] 使用统一应用内菜单与自绘窗口控制，移除系统菜单和空 Console
- [x] 持久化窗口位置/尺寸/最大化状态，纠正离屏窗口并限制单实例运行
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
- [x] Story / Substory 明确区分内部 `name` 与作者标题，在 Inspector 和资源树统一编辑、展示 `displayName` 标题
- [x] 多选节点提取为单入口、单出口 Substory
- [ ] Substory 文件夹、标签、收藏与按需索引（组织用途，不改变稳定 ID 所有权）
- [x] Substory 调用图与递归/循环依赖诊断
- [ ] Substory 公共/私有可见性评估
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
- [x] 建立项目级[编辑器撤销与重做规范](editor-undo-redo-spec.md)：所有内容新增、删除和修改默认必须原子 Undo / Redo
- [x] 按撤销规范审计 Story / Character / Variable / Asset / Event / Signal 与项目设置：补齐 Asset 编辑、Story/Substory 重命名、入口 Story/输出目录、批量角色标签及文本提交事务；跨文件恢复统一走资源写回队列
- [x] Project Variable / Event / Signal 的新增、删除与属性修改接入统一 History；参数改写和受影响的已打开 Story 作为同一事务恢复
- [x] 独立 Character / Asset 文件的新增与删除支持保留原相对路径、项目索引和稳定 ID 的 Undo / Redo；历史回放按队列原子调和资源快照并在失败时回滚磁盘
- [x] Story 文件新增/删除接入 History：保留原相对路径、完整文本、项目索引与打开标签；Undo / Redo 原子恢复或移除磁盘文件，失败时回滚
- [x] Substory 新增、删除、重命名及 Extract Selection 使用统一事务，不再通过清空 History 规避跨 Graph 撤销
- [x] History 记录用户可读的操作名称并暴露 canUndo / canRedo；Edit 菜单动态显示 `Undo Delete Character` / `Redo Extract to Substory` 并正确禁用空历史
- [x] 可停靠 History 面板按时间顺序显示可撤销、当前和可重做状态；点击记录可一次跳转多个步骤，并保留反向恢复链

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
- [x] Dialogue 语义约束：speaker Line 只保存角色实际台词；叙述、动作和环境描写拆为独立 Narration Node，AI 与导入规则同步遵守
- [x] AI 说话人解析：明确的新临时角色可通过同一事务 `add-character` 后绑定台词；身份不明确时询问作者
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

- [x] Text
- [x] Voice Asset（可选）

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
- [x] Condition 资源：稳定 ID、Name / Display Name / Description、Story 作用域与显式输入
- [x] Bool 输入支持 Inline Expression / Condition Reference 两种模式，并提供搜索与跳转编辑
- [x] Condition Tree 图形化编辑：All / Any / Not / Expression Leaf / Condition Reference Leaf
- [x] Condition Tree 与 Bool Expression 在语义可保持时双向转换；无法无损转换时保留原表示并提示
- [x] Condition 引用循环检测、作用域校验、引用索引、重命名安全、Undo/Redo 与 Git Diff
- [x] Compiler 将 Condition / Condition Tree 降级为普通 Boolean Typed Expression AST，Runtime 不增加树解释器
- [x] AI Command 支持 Condition 的创建、更新和引用，并纳入 Dry Run 与语义快照

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
- [x] Event / Signal 支持带引擎类型名的 opaque JSON 参数；编辑器只校验完整 JSON 并原样交给 Adapter，不把 Engine JSON 拆成 Story 逻辑
- [x] Event 支持多个稳定 ID 返回值；Adapter Promise 按 Output ID 返回并在 Runtime 校验后写入指定变量
- [x] Call External Function Out 在 Inspector 中支持下拉绑定与从 Story Data 拖拽变量绑定，并按类型提供投放反馈
- [x] Boolean / Number / String / Array / Map / Engine JSON 返回值
- [x] CharacterRef / AssetRef 参数与返回值：Runtime 传递稳定资源 ID，Inspector 提供角色/资产选择器，Adapter 不接收完整资源对象；引用类型仅支持同类相等比较
- [x] Struct 递归复杂参数，编译产物使用 JSON 兼容值；Struct 成员可在表达式中按类型访问
- [x] 参数支持 Literal、Expression、Variable Binding 和结构化编辑，Array / Map / Struct 可递归嵌套
- [x] Raw JSON 仅作为复杂参数的逃生编辑方式，提交前执行完整类型校验
- [x] Ink External Function 映射为 External Function Definition / Call External Function（稳定 ID、参数数量校验、显式绑定）

## Wait for Signal Node

- [x] 项目级 Signal Definition、稳定 Signal ID、Display Name、Description 与类型化参数 Schema
- [x] Signal 与 Event 合并为可复制 Markdown 的程序员接口表
- [x] Wait for Signal 节点、KDL、Compiler、Runtime 与 Preview 闭环
- [x] RuntimeState 序列化提前到达的 Signal Payload 队列；Wait 节点消费第一条匹配项
- [x] Pending Signal 可保存、恢复和通过 AbortSignal 取消 Adapter 等待
- [x] Boolean / Number / String Signal Payload；Wait 参数可逐项选择 Any 或 Match Expression
- [x] Engine JSON Signal Payload 支持 Any 或完整结构深比较，不把 opaque Engine JSON 拆成表达式逻辑
- [x] Engine JSON 可作为 Variable、Character Field 与 Substory Input / Output / Local 整值存储和传递；同名引擎类型才能连接或赋值，不提供成员访问和运算
- [x] 项目级 Engine Type Schema 资源：Name、Display Name、Description 与图形化字段定义
- [x] Engine Type Schema Designer：图形化增删、改名、排序字段并修改 Boolean / Number / String / Enum / Object / Array / Map 类型
- [x] Object 字段引用其他 Engine Type；Array 配置元素类型，并检测直接或间接循环引用
- [x] Array Item 可显式选择 Any JSON；每个 Item 独立选择 null / Boolean / Number / String / Array / Object 并图形化编辑
- [x] Schema 驱动 JSON Value Inspector：嵌套字段、数组项增删、默认值、可空与 Raw JSON 双向切换
- [x] Schema 变更影响预览与安全迁移：逐字段说明 Preserve / Initialize / Reset / Discard 策略；新增字段填默认值、字段改名保留值、删除字段清理值、类型不兼容重置默认值；列出受影响变量、角色、子故事、节点和其他 Story，并作为单次事务撤销
- [x] Engine Type 与字段使用稳定 ID；改名和排序不改变身份，新增/删除不会被误判为改名
- [x] Schema 迁移预览使用编辑器内对话框，不依赖系统 confirm；嵌套类型变更递归迁移所有父类型值
- [x] Schema 只用于作者表单、校验、文档和引擎契约；编译产物仍是普通 JSON，不生成成员访问或数据处理逻辑
- [x] Match Expression 到达 Wait 时求值并进入 PendingInteraction；未匹配 Payload 继续缓存
- [x] CharacterRef / AssetRef 专用引用类型：图形化资源选择、稳定 ID 存储与缺失引用校验
- [x] 结构化 JSON Value 支持复制、Schema 校验粘贴与一键恢复类型默认值
- [x] Map / Dictionary 图形化 Schema 与值编辑：String / Number / Enum / CharacterRef / AssetRef Key、递归 Value、重复 Key 防护、序列化和迁移
- [x] CharacterRef / AssetRef 递归引用索引：覆盖 Project / Story / Substory 变量、Character Field、Engine Type 默认值与节点 JSON，并支持精确路径跳转和删除保护
- [x] Character / Asset 项目级 Replace References：全项目预览、同类资源替换、磁盘 revision 校验、Story / Character / Project 原子写入并重新载入当前 Story
- [x] Character / Asset 项目级 Clear References：预览可安全清理与必填阻塞项；可选字段置空、数组元素和 Map 条目移除，非 nullable 字段保持不变
- [x] 引导式删除 Character / Asset：可选择替换后删除或安全清理后删除，必填引用阻止误删，引用写入、项目索引更新和资源文件删除使用同一原子回滚事务
- [x] 引用替换、清理与引导式删除接入 History：完整捕获所有 Story 和项目资源的前后快照，作为单个 Undo / Redo 条目顺序恢复
- [x] 持久化项目事务恢复日志：保留最近 5 次事务的 before / after 文件快照与变更摘要，区分 interrupted / completed，重启后可恢复任一侧或保留当前状态
- [x] 资源与字段统一使用命名后创建：输入期间允许为空，Enter 确认、Escape 取消，并在创建前检查名称格式和重复

---

## End Story Node

- [x] Render
- [x] 根 Story 终止语义
- [x] Chapter 内使用警告

## Story Control Nodes（跨 Story）

- [x] `Start Story`：启动另一个 Story 实例并传入参数
- [x] `Switch Story`：通过 Adapter 请求切换到目标 Story 实例
- [x] `Resume Story`：通过 Adapter 恢复已有 Story 实例或存档
- [x] `End Story Instance`：通过 Adapter 结束指定 Story 实例并继续当前流程
- [x] Story Control 的 Adapter、参数、存档边界、返回策略和失败诊断；Start / Switch / Resume 可把 Adapter 生成的实例 ID 写入 String 变量
- [x] Story 与 Substory 的调用边界和生命周期文档化；不把 Story Control 当作 Substory Call / Return

---

## Return Node

属性：

- [x] 仅在 Substory 中创建
- [x] UE Function 风格的多个命名 Typed Output；所有 Return 节点共享接口并分别填写表达式

---

## Chapter Node

属性：

- [x] Substory 稳定引用与下拉选择
- [x] UE Function 风格的 Typed Input Parameters、默认值与调用参数表达式
- [x] Substory Inputs / Locals 接入 Story Data，可编辑并拖出 Get / Set Variable
- [x] Completed 执行输出；多个命名 Output 可分别写入调用方变量

---

## Script Node

属性：

- [ ] Script ID
- [ ] Parameters
- [ ] 延后到基础 Call Event 完成后评估

---

## Ink Block Node

- [x] Embedded Ink：完整 Ink 文本保存在 `.story` 中
- [x] Linked Ink：引用项目内 `.ink` 文件，外部文件作为权威来源；支持 Inspector 切换、外部变更刷新、Preview 与 Build 解析
- [x] 接入完整 Ink Runtime，不要求先转换成原生节点
- [x] Ink Block 的入口、完成出口与 Story Typed Variable 显式桥接
- [x] Ink External Function 与 External Function Adapter 桥接（同步回调；异步调用保留原生 Call External Function）
- [x] Ink Runtime 暂停、选择、继续、错误和取消状态接入 Story Runtime
- [x] Linked / Embedded 模式明确单一权威来源，不自动双向同步文本与节点
- [x] Ink Block → Nodes 使用显式操作、Proposal Graph Diff Preview、Apply / Discard 与单步 Undo；保留原有入口/后继流程，分支结束自动通过 Flow Portal 汇合

---

## Comment Node

- [ ] Resize
- [ ] Color

---

# Milestone 4 - Property System

## Property Renderer

- [x] String / Multiline String
- [x] 表达式文本编辑、按需变量补全、紧凑运算符按钮与即时类型诊断
- [x] 变量选择器按名称/类型/作用域搜索，关闭时不渲染候选并限制展开结果数量
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
- [x] Emotion Key / Display Name / Portrait 结构化配置
- [x] Emotion 重命名同步 Dialogue Line 引用，删除时安全清理引用
- [x] Default Portrait 与 Emotion Portrait 选择器及编译期回退
- [x] Character / Emotion 跨 Story 引用列表、节点跳转与删除保护
- [x] Character Field（基础类型、CharacterRef / AssetRef、递归 Array / Map / Struct）定义、KDL 存储与稳定字段 ID
- [x] `CharacterName.fieldName` 表达式解析及 Get / Set Variable 选择
- [x] Character Field Runtime Adapter 读取、缓存与暂停点回写
- [x] Character Field 跨 Story 引用索引、字段 ID Binding 持久化与安全重命名
- [x] Character / Field 删除及字段改型的引用保护
- [x] Character Description / Dialogue Style 人物资料持久化、Inspector 编辑与 AI Semantic Context / Commands 支持
- [x] Character 列表显示脚本名与资料摘要；资源搜索覆盖人物背景、说话风格、情绪与字段
- [x] Character / Event / Signal 长文本使用延迟提交草稿；失焦与 Ctrl+S 立即保存，Escape 恢复，写入错误可复制
- [x] 有向静态 Character Relationship：KDL、Inspector、目标跳转、删除保护、搜索与 AI Commands / Semantic Context

## Project Variables

- [x] Project Scope 变量存入 `.storyproject`，不重复写入各 `.story`
- [x] Story Data 创建、编辑、拖拽 Get / Set 与节点 Inspector 选择
- [x] Project 编译时注入每个 Story Program，并校验 Story / Project 名称冲突
- [x] Runtime Adapter 启动读取与暂停点/结束回写
- [x] AI Semantic Snapshot 与 Add / Update Variable 命令支持 Project Scope
- [x] 删除前扫描已加载 Story / Substory 的稳定 ID 引用
- [x] Project Variable 引用跨 Story / Substory 跳转，并在重命名时批量改写已加载 Story
- [x] Story / Project 表达式与 Text Template 自动绑定稳定变量 ID，重命名时保留 Binding
- [x] 选择 Project Variable 时按需扫描项目内全部 Story，已打开 Story 使用内存版本覆盖磁盘索引
- [x] 未打开 Story 的引用可按需打开并定位；项目变量重命名批量改写受影响文件
- [x] 全项目索引完成前禁止删除、改名和改型；存在引用时禁止直接改型
- [x] Story 文本扫描结果按项目索引/Git Revision 缓存，切换变量时复用解析输入
- [x] 未打开 Story 批量改写携带内容指纹；写入前整批校验，并通过同目录临时文件、备份和失败回滚避免部分覆盖
- [x] Project Variable 改名将 `.storyproject` 与受影响的未打开 `.story` 作为同一事务写入；版本冲突时整批拒绝并支持重新扫描后重试

---

## Audio

- [x] Story Data Asset List 与 Voice / Portrait / Other 类型
- [x] Dialogue Voice Asset 引用
- [x] Search
- [x] Locale Voice Mapping
- [x] Voice / Portrait Asset 跨 Story 与 Character 配置引用列表、跳转与删除保护
- [x] Character / Emotion / Asset 引用单次共享索引与长列表渐进显示
- [x] Character 标签与可扩展标量 Metadata：编辑、搜索、KDL、语义快照及 AI Commands
- [x] Character 管理：标签筛选、多选批量标签、角色复制、头像状态、引用数量概览
- [x] Character Template：项目模板文件、从角色保存、内置模板、新建时选择、AI Command 并重建稳定 ID
- [x] Character Inspector 输入保护：表单事件与画布快捷键隔离，文本使用本地草稿并在失焦时提交
- [x] Character 编辑接入全局 Undo / Redo：Field、Emotion、Relationship、Tags、Metadata 与文本提交均可回退并同步项目资源

---

## Chapter

- [x] Substory / Chapter List
- [x] Parameter / Local Variable / Return Type：Inspector 编辑、Call 参数表达式与动态数据 Pin、Return 数据 Pin、KDL / Compiler / Runtime 全链路

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
- [x] Character 外部 Scope
- [ ] Project 外部 Scope
- [ ] Enum
- [x] Struct variables and recursive Array / Map element types
- [x] Nullable CharacterRef / AssetRef and nullable nested Struct fields
- [x] Variable 引用索引、安全重命名、删除保护与跨 Graph 节点跳转

---

## Localization

- [x] 内联默认文本与稳定 Text ID
- [x] 项目级 `.storyloc` 本地化表：提取 Dialogue / Choice、上下文筛选、逐条翻译、源文本刷新与稳定 Text ID 合并
- [x] Locale Fallback：可配置回退链，编译翻译模板并在 Runtime / Preview 中按语言解析，最终回退源文本

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
- [x] 新建项目自动生成保守的 `.gitignore` 模板，且不覆盖目录内已有规则
- [x] 工作区识别父级 Git 仓库；未受版本控制的项目可一键初始化 `main` 仓库
- [x] 检测外部 Git 分支 / detached HEAD 切换并自动重载项目资源与已打开 Story；未保存编辑受保护
- [x] 检测外部 merge / rebase 的 Git Index 冲突变化，从 Local Stage 安全载入 Story Merge
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
- [x] 静态端口派生、动态端口项序列化
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
- [x] Chapter 参数默认值、调用表达式与返回值静态类型校验
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
- [x] Story / Project Variable 可直接使用 Array 与 Map 容器类型；默认值图形化编辑并作为完整 JSON 值交给 Runtime / Adapter，不开放容器编程
- [x] Set Variable 对 Array 提供 Add Item、对 Map 提供 Set / Add Entry；整体 Set 保留，不扩展循环或通用集合算法
- [x] Safe Expression 支持 Engine Object `value.field`、Array `value[index]` 与 Map `value[key]` 读取；Runtime 对缺失字段、越界索引和缺失 Key 提供错误
- [x] 复杂值图形化读取基础：Get Variable 可选择 Engine Schema Field、Array Index 或 Map Key；输出数据 Pin 接入 Set Variable 并编译为 Typed Expression
- [x] 数据 Pin 扩展到 Branch 条件与 Event 参数；连线值覆盖节点内的后备表达式，并按目标类型校验
- [x] Engine Object 支持按需暴露多个 Schema Field Pin；主对象输出保留，字段引用使用稳定 Field ID，并随 Schema 迁移更新名称与类型
- [x] Dialogue / Choice 文本模板提供可搜索的引用插入器、Engine Object 标量字段选择与即时语法诊断；文本继续使用 `{value.field}`，不增加密集数据线
- [x] 复杂值边界固化：Array / Map / Engine Object 只开放安全的字段/索引读取、整值赋值、Array Add 与 Map Set Entry；不开放遍历、任意方法调用或通用图形化编程
- [x] Set Object Field 受限修改 Engine Object 的一级 Schema 字段；保存稳定 Field ID、校验字段类型，并在 Runtime 不可变写回整个对象
- [x] Array / Map 变量保存元素、Key 与 Value 类型；读取 Pin、Add Item、Set Entry、默认值编辑和连线校验共享强类型契约，Character / Asset Key 使用稳定资源 ID
- [x] 容器修改节点完成数据 Pin：Array Item、Map Key / Value、Object Field Value 使用序列化类型快照即时校验；Inspector 值作为断线后备值
- [x] Engine Object 使用最新 Schema 动态投影；Schema 迁移确认集中递归规范化父 Object、Array / Map、变量和节点整值，Field ID 负责改名匹配
- [x] Any JSON 内的命名 Object 使用稳定 Engine Type ID 标记，不再依赖结构猜测；编译产物递归移除编辑器类型标记
- [x] Project / Story / Chapter / Character Variables 状态机集成
- [x] Typed Return Value
- [x] 无返回值 Substory Call Stack / Return
- [x] End Story
- [x] Story Control 指令通过可序列化 PendingInteraction 交给 Adapter；Start / Switch / Resume / End Instance 的结果可按输出 ID 写回变量
- [x] 稳定点 Save / Load（Preview 本地槽验证 RuntimeState 契约）
- [x] Pending Dialogue / Choice / Signal 与 Signal Inbox JSON 往返恢复
- [x] Ink Block 子运行时的暂停、选择、恢复与终止（稳定交互 ID、可序列化 Ink 状态、陈旧 Choice 拒绝、END / Abort 验证）
- [x] Program Format / Version / Content Version 检查
- [x] 核心执行状态机结构化 Runtime Diagnostics

---

## Engine Adapter

- [x] StoryAdapter TypeScript 契约
- [x] Dialogue / Choice 异步接口
- [x] Event Registry 与 Typed Parameters / 多 Result
- [x] `callEvent(eventId, arguments, signal)` 异步调用协议
- [x] 游戏引擎按稳定 Event ID 注册具体 Handler
- [x] Story Control 统一 Adapter 控制请求：Story ID、实例 ID、参数、等待策略与 JSON 返回值
- [ ] Wait / Fire-and-forget、返回值与 Failed 分支语义
- [ ] Text / Voice / Asset 解析
- [x] External Variable 读写
- [x] AbortSignal 取消
- [x] Adapter 返回值校验与错误策略

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

- [x] Large Graph Test：覆盖 KDL 往返、Editor Graph 加载/保存、自动布局与项目编译
- [x] 1000 Nodes Test：每个 CPU 阶段设置宽松性能门禁，防止恢复为平方级连接扫描

---

## Stability

- [ ] Memory Leak Check
- [x] Crash Recovery：逐项恢复、另存为、丢弃，显示磁盘状态并保护损坏恢复数据
- [x] 外部文件变更保护：自动重载干净文件，重叠 Story 进入三方 Merge，资源与删除变更显式审查
- [x] 外部文件变更回归测试：内容指纹 Diff、自保存过滤、干净/脏文件决策、删除重建、快速保存与 Git checkout 可控时钟抑制

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
- [x] Add / Update Character（含 Character Field）
- [x] Add / Update Variable（含 Project Scope）
- [x] Set Expression（Branch、Set Variable、Choice 条件、Event 参数与 Signal Match）
- [x] Add / Update / Remove Dialogue Line
- [x] Add / Update / Remove Dialogue Line and reorder existing Lines
- [x] Add / Update / Remove Choice Option and reorder existing Options
- [x] Create / Refactor Chapter：AI 支持 add-substory 与 update-substory，完整替换接口并同步 Call / Return 动态 Pin 与失效连线清理
- [x] Ink Import：Ink 可导入为原生节点；无法无损映射的内容保留为可运行的 Ink Block。
- [x] 显式 Validate / Auto Layout 命令：`validate-graph` 只读校验目标 Graph，`layout-selection` / `layout-neighborhood` 返回布局意图，不直接写入坐标
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
- [x] SSE 流式 AI 请求；不支持 SSE 但返回标准 Chat Completion JSON 的 Provider 使用兼容回退
- [x] 大型 Story 的 AI 上下文预算裁剪：完整快照、压缩快照和节点 Manifest 三级降级
- [x] Provider 无关的只读 AI 工具循环：Story 搜索、节点/角色/Graph 查询与 validate_command，最多 3 次且不允许直接 Apply
- [x] AI 通过 `add-substory` 事务创建带 Entry / Return 初始 Graph 的 Substory，并纳入 Dry Run、编译与 Undo
- [x] Provider 思考模式与会话级 reasoning 展示（默认折叠、可复制、不进入项目数据）
- [x] 会话式 Story Assistant：理解最新 Story 状态、回答 / 追问、可选命令提案与会话隔离
- [x] Codex 风格 chat-first 交互：底部 Composer、键盘发送、自动滚动、上下文与工作状态、提案审核卡片
- [x] 按 Workspace + Story 持久化 AI 会话，支持历史切换、新建和删除，不污染项目文件
- [x] 项目级 `STORY_BLUEPRINT_AI.md`：新建项目自动生成、AI 请求由主进程读取并作为可版本控制的协作契约；避免被开发代理误识别为仓库指令
- [x] 旧项目中由 Story Blueprint 生成的 `AGENTS.md` 在首次 AI 请求时安全迁移为 `STORY_BLUEPRINT_AI.md`；不触碰其他工具创建的同名文件
- [x] 复杂数据深层 Focus 编辑：Object / Array / Map 嵌套达到第 3 层后停止继续压缩 Inspector，改用独立大编辑区完成编辑
- [x] 复杂数据字段级诊断：按路径校验 Object Field、Array Element、Map Key/Value、枚举和 Character/Asset 引用；父级折叠标题及 Focus 入口汇总错误数量
- [x] 大型复杂容器窗口化与检索：Array / Map / Free Object 分批渲染，每批 50 项；支持索引、Key、JSON 内容及 Character/Asset 显示名搜索并显示匹配规模
- [x] AI 请求始终合并最新版内置契约与项目 `STORY_BLUEPRINT_AI.md`，旧项目不再冻结在创建时模板；增减变量明确使用 read-modify-write 表达式
- [x] AI `add-variable-adjustment` 高层操作按稳定变量 ID 与 signed delta 生成自绑定 Set Variable；相对修改请求中的字面量覆盖在 Dry Run 阶段阻止 Apply
- [x] AI 参考文件附件：作者显式选择文本文件，数量和大小受限，仅附着于当前请求且不写入 Story 或聊天历史
- [x] AI 会话标题独立可编辑：首次消息仅用于默认命名，后续重命名持久化且不被新消息覆盖
- [x] 长篇小说 / 轻小说改编保真规则：默认保留场景、台词、叙述、心理和节奏，超长内容分批处理并报告覆盖范围
- [x] SSE 流式命令生成与标准 Chat Completion 兼容回退
- [x] Provider 能力配置：流式策略、只读工具开关、Full / Compact / Manifest-first 上下文策略
- [x] Manifest-first 只读工具循环：按需读取节点、角色、Graph，并限制工具结果大小
- [x] AI 工具调用轨迹可展开查看，便于诊断上下文读取与 token 消耗

---

# Milestone 12 - Ink Interoperability

完整运行 Ink Block 与 Ink 节点化是两条可共存路线。近期优先保证任意 Ink 可以作为
Linked 或 Embedded Ink Block 运行；完整节点转换不阻塞这一能力，并作为后续渐进目标。

## Ink Block Runtime

- [x] 集成 Ink Runtime，执行完整 Ink 语言而非仅支持子集
- [x] Linked `.ink` 与 Embedded Ink Source 加载、编译和诊断
- [x] Ink Variable 与 Story Typed Variable 显式桥接（Story → Ink、Ink → Story、Two-way）
- [x] Ink External Function 与项目 External Function Definition 映射
- [x] Ink Choice / Continue 与 Story Runtime PendingInteraction 桥接
- [x] Ink Block 运行状态参与 Save / Load、Abort 和结构化 Diagnostics

---

## Versioned Ink Profile

- [x] 定义第一版可转换为原生节点的版本化 Ink Profile
- [x] 建立完整 Ink 语法与原生节点类型的覆盖矩阵（见 `docs/ink-profile.md`）
- [x] Speaker / Voice / Emotion / Text ID Tag 规范：同一 Ink 输入行使用稳定 ID 标签，编译期资源校验，Runtime 映射到 DialogueRequest，普通标签透传 Adapter
- [x] Tag 转义与稳定 ID 规则：Dialogue Ink 输入校验 `text-id`，拒绝重复 / 非法 ID；运行时映射保留 Text ID、Speaker、Voice、Emotion 与普通标签
- [x] Ink `VAR` / 赋值与 Boolean、Number、String Story Variable 映射
- [x] 连续 Ink 台词合并为多 Line Dialogue，控制流边界处自动拆分
- [x] Expressions 保持内嵌，不把普通运算展开成大量数据节点

---

## Ink Import

- [x] 明确不提供 `.story` → `.ink` 语义导出，也不提供原生节点 → Ink Block 反向转换
- [x] 受支持 `.ink` → Typed Story Graph Proposal，Apply / Discard 与单步 Undo
- [ ] 完整 `.ink` → 原生节点的长期转换目标
- [x] 暂未覆盖的结构保留为可完整运行的 Ink Block，并提供 Diagnostics / Preview
- [x] 原生 `.ink` 文件 → Nodes 显式转换入口、行列 Diagnostics 与可移动 Diff Preview
- [x] Linked / Embedded Ink Block → Nodes 显式转换，支持受限 Profile、可移动 Diff Preview、Apply / Discard 与 Undo
- [x] 导入前显示语义 Diff，不承诺保留原始空白、排版和注释位置

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
- [x] Git Index 冲突检测与 Base / Local / Remote 三方合并；普通保存受保护，合并结果显式写回但不自动 Stage
- [x] 项目级 Character / Asset / Event / Signal 资源三方冲突合并与跨 Story 编译校验
- [x] Git Add/Add、Modify/Delete 类型的项目资源冲突可视化 Keep/Delete 处理
- [x] Story Merge 只读 Graph Preview：节点与连线新增、修改、删除、冲突高亮，冲突列表联动切图聚焦
- [x] Graph Preview 内直接处理节点/连线冲突、Previous/Next 导航及远端新增 Substory 虚拟 Graph
- [x] 合并完成门禁：显式冲突归零、最终变更审查、非写入式预检及 Git Stage 指纹失效保护
- [x] 坐标冲突按 `{x, y}` 整体处理，支持批量保留 Local / Remote 与局部邻域自动整理
- [x] Story v4 将节点逻辑与 `layout` 坐标分区持久化；坐标合并支持 Local/Remote 顺序优先的单步非 Rerouter 邻域整理
- [x] 同一执行边上的双分支并发插入（单节点或简单线性节点链）可选择 Local→Remote、Remote→Local、只保留 Local 或只保留 Remote
- [x] 无法线性化的分支、循环、删除和 Rerouter 等执行结构按连通变化区域分组，一次选择完整 Local / Remote 拓扑
- [x] Execution Region 选择动态覆盖已删除节点的 Modify/Delete 从属冲突；统计、导航、验证和 Apply 统一忽略失效冲突
- [x] Execution Region 区分变化核心与稳定边界，按边界拆分独立冲突并显示影响摘要；过大区域必须逐项二次确认
- [x] Execution Region 高级模式允许每个竞争输出独立选择 Local / Remote；全选后重建混合拓扑并清理不可达的分支独占节点
- [x] 同一 Data Input 的 Local / Remote 竞争来源转为可选择的语义冲突
- [x] Local / Remote 同时替换 Start 时生成入口二选一冲突，Apply 前强制每个 Graph 只有一个入口
- [x] Line / Option / Parameter 等有序集合在同一位置并发插入时显式选择 Local-first / Remote-first
- [x] 复杂 JSON 值按字段和数组元素做三方语义合并；无稳定 ID 的数组使用序列对齐，冲突定位到具体嵌套路径，并忽略编辑器内部类型标记
- [x] 复杂 JSON 冲突可视化：显示嵌套字段短名、完整路径及 Base / Local / Remote 三方值；容器顺序冲突提供 Local-first / Remote-first 决策
- [x] AI Commands 支持 `layout-selection` 与 `layout-neighborhood` 布局意图，不允许 AI 直接生成 `x/y`
- [ ] Multi-user

---

## Runtime

- [x] External Function Out 数据 Pin：Call External Function 的每个返回值可作为强类型数据源，连接到 Set Variable / Branch 等节点；运行时缓存可序列化并支持多个消费者，保留 `resultVariableIds` 兼容路径
- [ ] Unity Adapter
- [ ] Unreal Adapter
- [ ] Godot Adapter

---

## Application Updates

- [x] 应用级 Feed URL、Stable / Beta、启用和启动检查配置（存入 userData，不进入项目文件）
- [x] Help → Check for Updates 手动检查、版本比较、Release Notes 和下载入口
- [x] HTTPS Feed / Artifact URL 安全边界；开发环境允许 localhost HTTP
- [x] 版本化 JSON Update Manifest、相对产物 URL 和 SemVer / prerelease 比较
- [x] Release 脚本生成 Update Manifest 与安装器 / Portable SHA-512、大小和相对 URL
- [x] 发布公钥内置、Ed25519 Manifest 签名验证；未签名、篡改或未知 key 的清单拒绝进入更新流程
- [x] 应用内下载已验签 Artifact，流式 SHA-512 / 大小校验、进度、取消和安全落盘；Installer / Portable 均由用户显式打开
- [x] NSIS Installer 下载后显式确认、检查未保存 Story、退出并启动安装器；Portable 仅下载和提示替换

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
