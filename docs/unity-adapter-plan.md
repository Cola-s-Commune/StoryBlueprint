# Unity Adapter 实施计划

## 当前基线

- Editor、Compiler 与 TypeScript Runtime 已实现；项目可导出版本化 `.storyc.json`。
- `StoryAdapter`、运行时交互、外部变量读写、Event / Signal / Story Control 契约已在 TypeScript Runtime 中定义。
- 当前仓库没有 C# Runtime、Unity Package、Unity 示例工程或 Unity 自动化测试。
- Ink Block 的编译产物嵌入 Ink 专用 JSON，并依赖 `inkjs` 语义；第一版 C# Adapter 不应假称兼容 Ink Block。
- 现有接口部分结果是异步的，但 Ink `EXTERNAL` 当前要求同步回调；跨语言实现需明确拒绝未支持的 Ink EXTERNAL，或单独评估 Ink Unity Runtime 集成。

目标：实现一个可从 Unity 加载 `.storyc.json`、驱动原生 Blueprint Runtime 指令并把交互委托给 Unity 游戏代码的 C# Package。先验证核心格式与运行语义，再扩展 Unity 展示层；不把编辑器功能移植到 Unity。

## 阶段 0：冻结 C# 接入契约

- 从 `docs/examples/sample-quest.storyc.json` 和 `packages/common/src/types/` 建立公开 C# DTO / JSON schema 对照。
- 核对导出文件实际包络：项目级 `story-blueprint-compiled-project` 中包含逐 Story 的 `story-runtime` Program，而不是直接把 standalone RuntimeProgram 当成项目文件。
- 明确受支持的 `format`、版本号、`RuntimeProgram.version`、必填字段、未知字段策略和 JSON 数字规则。
- 逐条审计 Runtime 指令：Dialogue、Narration、Choice、Branch、Jump、Set Variable、Call Event、Wait Signal、Chapter、Story Control、Return、End、Ink Block。
- 冻结结果类型、取消、错误、外部变量持久化、内容版本与存档契约；对 `waitForCompletion=false` 定义后台实例生命周期与返回值语义。
- 明确 v1 不支持项，并在导入时返回带路径的错误，不能跳过未知指令继续运行。

验收：契约文档、C# 模型字段矩阵和基于实际导出样本的兼容测试 fixture 齐备；所有不支持能力均有显式错误码/说明。

## 阶段 1：纯 C# Runtime Core

- 建立独立 Unity Package 仓库内目录（建议 `integrations/unity/`），以 asmdef 隔离运行时代码，不依赖 UnityEditor。
- 实现 `.storyc.json` 解析、项目/Story 选择、格式与版本校验、结构校验、内容版本检查。
- 实现基础指令状态机与可序列化状态：Dialogue、Narration、Choice、Branch、Jump、Set Variable、End。
- 实现与 TypeScript 一致的表达式子集、文本插值和 Choice visible/enabled 条件；如不能完整一致，先用能力声明拒绝不兼容表达式。
- 定义 C# `IStoryAdapter` / async driver，使用 `Task` + `CancellationToken`，覆盖台词、旁白、选项、外部变量、Event、Signal。
- 建立可离线运行的 NUnit/EditMode 测试；将 TypeScript 的 fixture/测试场景做成跨实现一致性用例。

验收：Unity 外可独立验证的纯 C# 核心能够运行示例中的对话和分支；重复运行在相同选择和输入下得到相同结果；取消与非法 Choice 可预测且可测。

## 阶段 2：补齐 Runtime 语义

- 实现 Array / Map / JSON 值和容器操作，遵守现有 ValueType / Engine Type 契约。
- 实现 Call / Return、Substory 参数、局部变量和输出值。
- 实现 Call Event 多输出及稳定 Output ID 校验。
- 实现 Wait Signal 的缓存、匹配、消费和存档恢复行为。
- 实现 Start / Switch / Resume / End Story 实例控制，定义实例注册表、等待策略、失败与销毁语义。
- 对每个功能复用 TypeScript 端 fixture，做双端输入/状态/交互轨迹一致性测试。

验收：除 Ink Block 及明确列出的后续能力外，v1 声明支持的 Runtime 指令均覆盖；跨语言一致性测试通过。

## 阶段 3：Unity 包与展示组件

- 提供 `package.json`、asmdef、UPM 安装说明、程序集 API 文档和最小 demo scene。
- 提供 Unity 主线程调度适配，确保 Runtime 可异步等待 UI，同时所有 Unity API 调用回到主线程。
- 提供可替换的 Dialogue / Choice presenter 示例，不绑定特定 UI 框架。
- 同一份剧情同时支持两种交互策略：
  - **手动推进模式**：对白/旁白显示后等待玩家点击继续；Choice 显示选项并等待玩家选择。
  - **自动播放模式**：对白/旁白按配置的显示时长自动继续；Choice 默认仍暂停等待玩家选择，只有宿主明确启用限时 Choice 才自动结束等待。
- Runtime 不保存“手动/自动”作为剧情数据；策略属于 Unity Presenter / Adapter 配置，保证同一个 `.storyc.json` 可以被文字游戏和自动播放游戏复用。
- Presenter 必须支持跳过当前文字、取消当前等待和场景切换清理；自动播放计时器、打字机任务和 UI 回调都必须绑定 `CancellationToken`，避免旧对白在读档或销毁后继续推进。
- 自动播放计时建议提供固定时长、按文本长度计算和语音结束后三种宿主策略；策略只决定何时完成 `showDialogue`，不改变 Runtime 的控制流。
- Dialogue 与 Narration 均通过同一套等待/取消语义接入；没有专用 Narration UI 时允许回退到 speakerless Dialogue。
- 提供 Character、Asset、Voice、Portrait、Localization 的解析/回调接口；资源解析与 JSON 中的稳定 ID 分离。
- 提供 ScriptableObject 或普通 C# 配置承载项目文件路径、入口 Story、locale 与 Adapter 实现，不把项目源资源复制成第二权威数据。
- 覆盖对象销毁、场景切换、取消、重复实例和异常时的清理行为。

验收：新建 Unity 项目按文档安装后，Demo 场景可加载仓库示例产物；分别以手动推进和自动播放模式完成同一段对白，Choice 在两种模式下都能正确选择；跳过、取消、切场景不会留下悬挂任务，并通过 Adapter 调用一个假 Event。

## 阶段 4：存档、兼容与发布

- 公开 `ExportState` / `RestoreState`，校验 Story ID、Program ID 和 Content Version。
- 支持运行暂停点、变量、调用栈、Pending Choice / Signal 和活动 Story Instance 的存档恢复。
- 定义旧/新 Runtime Program 版本策略：兼容时显式迁移，不兼容时保留存档并返回迁移诊断，不静默重置进度。
- 增加 IL2CPP / AOT、低 API Compatibility Level、WebGL（若在目标内）和主流 Unity LTS 的构建验证。
- 建立 UPM Git URL / tag 发布流程、CHANGELOG、API 兼容策略和最小示例项目 CI。

验收：示例项目可在目标 Unity LTS 构建；存档往返测试通过；文档列出支持版本、平台、运行格式和限制。

## 建议的 v1 边界

- 支持当前 `.storyc.json` 包络与 Runtime Program version 7；unsupported version fail fast。
- 第一版聚焦原生 Blueprint 指令。Ink Block (`inkJson`) 明确诊断为 UnsupportedInstruction；后续单独评估 Ink C# / Unity Runtime、状态序列化和 EXTERNAL 同步语义后再纳入。
- Event 与 Signal 是宿主回调契约，不尝试跨语言序列化游戏对象、UnityEngine.Object 或委托。
- Character / Asset / Voice / Portrait 以稳定 ID 交给 Unity resolver；不推断磁盘路径或 Resources 路径。
- C# JSON 表示先以 `System.Text.Json` 或 Unity 目标版本兼容的包为候选，阶段 0 实测 Unity 最低版本、IL2CPP/AOT 和保留字段策略后再定，不直接依赖反射式动态类型。
- 每个指令提供结构化诊断：code、message、storyId、blockId、instructionId、JSON path；不得通过 `Debug.Log` 后继续执行来吞掉错误。

## 是否需要新建 Unity 项目

需要一个新的、最小的 Unity 示例项目用于集成验证，但它不是 Adapter 本身，也不应成为 Runtime 的唯一开发环境。

- **Adapter / C# Runtime**：作为仓库内可发布的 UPM Package 开发，建议放在 `integrations/unity/package/` 或独立仓库；核心程序集不依赖某个游戏项目，不依赖 `UnityEditor`。
- **Unity 示例项目**：单独放在 `integrations/unity/samples/RuntimeDemo/`（或单独仓库），只包含 Demo 场景、Presenter、假 Event / Signal、示例资源和测试配置。它引用本地 UPM Package，并加载 `docs/examples/sample-quest.storyc.json` 的复制品或 CI 生成产物。
- **纯 C# 测试**：在 Unity 外运行，覆盖 JSON 解析、状态机、表达式、存档和手动/自动交互完成时机，避免每个逻辑测试都依赖启动 Unity。
- **Unity Test Framework**：在示例项目中覆盖主线程调度、Presenter、场景销毁、CancellationToken、IL2CPP/AOT 和真实 UI 交互。
- **仓库策略**：第一阶段先创建目录和包骨架，再创建最小示例项目；不要把完整商业游戏、素材库或游戏特有逻辑放进 Adapter 仓库。

换句话说：做 Adapter 不需要把 Story Blueprint 编辑器改造成 Unity 项目，也不需要先创建一个完整游戏。需要的是“可发布 Package + 最小验证项目”两个独立层次。

## 主要风险与决策点

1. 表达式语言一致性：当前表达式是 Blueprint 自定义 typed AST，不是 C# 表达式。需要 C# 解释器及跨语言语义测试。
2. 运行状态与存档：JSON state 的版本、Pending Interaction、Signal Inbox 和 Story 实例必须在跨版本加载时保持契约。
3. 非等待 Story Control：TypeScript Adapter 契约已有 `waitForCompletion`，C# 必须定义实例拥有者和后台异常上报。
4. Ink Block：完整兼容需要 Ink C# Runtime、compiled Ink 格式兼容、Ink State 存档及同步 EXTERNAL 桥接，不能放进基础 v1 承诺。
5. Unity 版本与 JSON 库：最低 Unity LTS 版本会影响 async API、JSON 库、AOT 和包分发，进入阶段 0 后应先做技术 spike。

## 首个可交付切片

建议先完成“阶段 0 + 阶段 1 的最小核心”：加载示例 `.storyc.json`，运行对白、二选一 Choice、Branch、Set Variable、End，支持 CancellationToken 和纯 C# 测试。随后创建最小 Unity RuntimeDemo，接入一个手动推进 Presenter 和一个自动播放 Presenter，验证同一产物在两种体验下的交互轨迹一致；再根据真实 adapter 消费反馈决定是否一次性纳入 Substory、Signal 和 Ink，不要先建设庞大的 Unity UI 框架。
