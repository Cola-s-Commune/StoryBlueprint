# Story Blueprint 核心系统设计

> Status: Accepted for implementation
>
> 本文记录 Story Blueprint 的节点语义、连接规则、表达式系统、角色与对话资源、Ink 互操作、源文件格式，以及编译后 Runtime 数据格式。

---

## 1. 设计目标

Story Blueprint 是独立于具体游戏引擎的可视化剧情与流程编辑框架。

核心目标：

- 编辑体验接近 Unreal Engine Blueprint。
- 条件与计算体验接近 Scratch，不要求为简单运算创建大量节点。
- 编辑器源文件适合版本控制、人工阅读和长期迁移。
- 编译产物只描述可执行逻辑，不携带编辑器节点信息。
- TypeScript Runtime 不依赖 Electron、React 或具体游戏引擎。
- Engine Adapter 负责 UI、音频、资源和游戏事件等实际表现。
- 对话可以与 Ink 在约定范围内相互转换。

非目标：

- Runtime 不解析 React 或 TypeScript 源代码作为剧情资源。
- Runtime 不理解节点坐标、端口布局、颜色或编辑器状态。
- 第一版不追求完整复制 Ink、UE Blueprint 或 Scratch 的全部能力。

---

## 2. 总体数据流

```text
.story（KDL 编辑器源文件）
  节点、端口、连线、坐标、注释、编辑器信息
                    │
                    ▼
              Story Compiler
     解析 → 校验 → Story AST → 控制流分析
                    │
          ┌─────────┴──────────┐
          ▼                    ▼
.storyc.json（运行逻辑）  .storyc.json.map（可选）
  指令、表达式、跳转       源节点调试映射
          │
          ▼
  TypeScript Story Runtime
          │
          ▼
       Engine Adapter
  UI / Audio / Asset / Event
```

Ink 是导入和导出格式，不是 Story Blueprint 的唯一主存储格式：

```text
.story ⇄ Story AST ⇄ 受支持的 .ink 子集
```

---

## 3. 节点体系

### 3.1 MVP 节点

| 节点         | 用途                        | 执行输入 | 执行输出             |
| ------------ | --------------------------- | -------: | -------------------- |
| Story Entry  | 根 Story 入口               |        0 | Next                 |
| Dialogue     | 显示角色对话                |        1 | Next                 |
| Narration    | 显示无说话人的旁白          |        1 | Next                 |
| Choice       | 等待玩家选择                |        1 | 每个选项一个动态输出 |
| Branch       | 根据布尔表达式自动分流      |        1 | True / False         |
| Set Variable | 修改 Story 变量             |        1 | Next                 |
| Call Event   | 调用 Adapter 注册的游戏事件 |        1 | Next 或结果分支      |
| Call Chapter | 调用可复用 Chapter          |        1 | Completed            |
| End Story    | 结束整个 Story 实例         |        1 | 0                    |
| Return       | 从 Chapter 返回调用点       |        1 | 0                    |
| Reroute      | 整理连线，不产生运行指令    |        1 | 1                    |
| Comment      | 编辑器注释，不参与运行      |        0 | 0                    |

### 3.2 后续节点

- Switch
- Sequence
- Random
- Wait Event
- Parallel
- Gate
- Quest State
- Timeline / Cutscene
- Ink Block
- Subgraph

### 3.3 Choice 与 Branch

二者必须保持不同语义：

- Choice 由玩家主动选择，选项数量可动态变化。
- Branch 由 Runtime 自动计算布尔表达式，固定输出 True 和 False。

### 3.4 End Story 与 Return

二者在运行语义上不同：

- End Story 终止整个 Story 运行实例。
- Return 结束当前 Chapter，并返回 Call Chapter 的下一条指令。

为了降低误用：

- 根 Story 只能创建 End Story。
- Chapter 内由编辑器提供 Return。
- Return 不出现在根 Story 的普通节点菜单中。
- 第一版若尚未实现 Chapter，可以只开放 End Story，但数据模型应预留 Return 指令。

补充约束：

- 根 Story 的所有正常可达路径必须以 End Story 结束。
- Chapter 的所有正常可达路径必须以 Return 或 End Story 结束，不允许隐式返回。
- Chapter 内允许使用 End Story，但编辑器必须显示警告，因为它会终止整个 Story 实例而不是只退出 Chapter。
- 第一版不支持 Chapter 递归调用。
- Chapter 支持输入参数、局部变量和一个可选返回值；需要多个返回字段时使用结构体。
- Return 的返回值类型必须与 Chapter 声明一致。

编辑器面向作者统一称为 **Substory（子故事）**，Source Model 与 Runtime 中继续使用
`Chapter` 作为稳定技术术语。一个 Story 资源包含一个 Main Story 和零到多个 Substory。

### 3.1 从选区提取 Substory

第一阶段只允许提取单入口、单出口的控制流选区：

- 选区不能包含根 Entry、End Story 或已有 Return。
- 必须恰好有一条外部执行线进入选区，并恰好有一条执行线离开选区。
- 跨选区的数据连线暂不自动转换为参数，检测到时拒绝提取。
- 提取后，子故事自动补 Entry 和 Return；原图以 Call Substory 替换选区并保持外部连线。
- 多入口、多出口和数据依赖将在参数、返回值与高级重构预览完成后支持。

---

## 4. UE 风格端口与连接规则

### 4.1 端口类型

节点提供两类端口：

1. 执行端口（Execution Pin）
   - 决定剧情执行顺序。
   - 用箭头和执行连线表示。

2. 数据端口（Data Pin）
   - 传递 Boolean、Number、String、CharacterRef、AssetRef 等值。
   - 端口颜色由数据类型决定。

### 4.2 基本规则

- 只能从输出端口连接到输入端口。
- 端口类型必须兼容。
- 数据输入只能连接一个来源。
- 数据输出可以被多个节点读取。
- 普通执行输出只能连接一个后继。
- 多路执行必须通过 Choice、Branch、Sequence 等明确节点表达。
- Story Entry 不能有执行输入。
- End Story 和 Return 不能有执行输出。
- 允许显式循环和自循环，以支持重试、循环对话和任务流程。
- Compiler 对没有等待、选择或外部事件的紧密死循环报错，对其他无法证明会终止的循环给出警告。
- 未连接节点可以在编辑期间存在，但编译时按严重程度产生错误或警告。
- 创建新连接替换旧连接时，必须提供明确的视觉反馈。
- 删除节点时自动删除与之关联的边。

### 4.3 端口持久化

- 静态端口由版本化 Node Definition 派生，不写入 `.story`，避免节点定义升级后出现两份真相。
- Choice 等动态端口保存稳定的动态项 ID，例如 `optionId`，端口 ID 由动态项生成。
- Edge 始终引用 `nodeId + portId`，不得引用数组下标或显示文本。
- 节点类型包含定义版本，例如 `dialogue@1`；加载旧版本时先执行迁移。
- 删除动态端口前必须检查并处理关联 Edge，不能留下悬空连接。

### 4.4 编辑交互

- 右键空白处打开节点创建菜单。
- 从端口拖到空白处时，只显示兼容节点。
- 支持节点和边的创建、删除、框选与多选。
- 支持复制、粘贴、Duplicate。
- 支持 Undo / Redo。
- 支持 Reroute 和 Comment 整理大型蓝图。

---

## 5. Scratch 风格表达式系统

简单数学和布尔运算不拆成大量蓝图节点，而是在需要表达式的节点内部使用积木式编辑器。

示例：

```text
[角色变量: 好感度] [>=] [10]
并且
[任务变量: 找到钥匙] [==] [是]
```

`.story` 源文件中保存可读表达式：

```kdl
condition "favor >= 10 && hasKey"
```

Compiler 将表达式解析为带类型的 AST：

```json
{
  "kind": "and",
  "operands": [
    {
      "kind": "compare",
      "operator": ">=",
      "left": { "kind": "variable", "id": "favor" },
      "right": { "kind": "literal", "value": 10 }
    },
    {
      "kind": "variable",
      "id": "hasKey"
    }
  ]
}
```

同一套表达式系统用于：

- Branch 条件
- Choice 选项显示条件
- Dialogue 显示条件
- Set Variable 的值表达式
- Event 参数

Runtime 只计算表达式 AST，不使用 `eval` 执行源字符串。

表达式采用“双表示”策略：

- `.story` 保存适合人类和 AI 阅读的表达式源码。
- 编辑器内存同时维护解析后的 Typed Expression AST 和符号绑定。
- 变量引用绑定稳定 ID，而不是仅依赖变量名称。
- 重命名变量属于结构化重构操作，必须同步更新表达式源码并重新校验绑定。
- 文件加载时重新解析表达式；语法错误、类型错误和失效引用在编译前报告。
- Runtime Program 只包含 Typed Expression AST，不包含需要动态解析或 `eval` 的源码。

---

## 6. Blackboard 与项目数据

编辑器提供类似 UE Blueprint 的 Story Data 面板，默认放在 Resource Browser 下方的左下区域。

面板管理：

- Characters
- Variables
- Assets
- Events
- Chapters

所有可引用对象使用三层命名：

```ts
interface NamedObject {
  id: string; // 永久稳定，不随重命名变化
  name: string; // 项目或作用域内唯一的脚本名称
  displayName: string; // 面向作者和玩家的展示名称，可本地化
}
```

Edge、表达式绑定、AI 命令和编译产物引用 `id`；编辑器与 KDL 可以额外显示 `name`。数组下标、画布坐标和展示文字不能充当引用。

支持把条目拖入蓝图：

- 把变量拖到画布，创建 Get Variable 或 Set Variable。
- 把角色拖到画布，创建 Character Reference。
- 把角色拖到 Dialogue，直接设置 speaker。
- 把资源拖到对应字段，设置 AssetRef。

### 6.1 变量与作用域

当前编辑器定义三种内部作用域；Project / Character 外部变量待 Adapter 生命周期落地后再加入：

| 作用域  | 生命周期        | 典型用途               |
| ------- | --------------- | ---------------------- |
| Story   | 当前 Story 实例 | 当前剧情流程状态       |
| Chapter | 每次调用创建    | 参数、临时计算、返回值 |
| Local   | 当前执行上下文  | 临时计算               |

约束：

- 每个变量必须声明稳定 ID、可读名称、类型、作用域和默认值。
- 当前编辑器支持 Boolean、Number、String；Enum、结构体、可空类型和数组后续加入。
- 禁止隐式 String/Number/Boolean 转换，转换必须在表达式中显式写出。
- Chapter 参数按值传入，局部变量随 Call Frame 创建，Return 可以返回一个声明类型的值。
- Project 和 Character 变量的读取、写入及持久化通过 Adapter 完成。
- 删除或改型变量前必须执行引用检查和迁移预览。

### 6.2 角色定义

角色应使用稳定 ID，而不是显示名作为引用：

```ts
interface CharacterDefinition {
  id: string;
  name: string;
  displayName: string;
  defaultPortrait?: AssetRef;
  emotions: Record<string, CharacterEmotion>;
  voiceNamespace?: string;
}
```

对话中的说话人既可以是固定 CharacterRef，也可以由表达式动态决定。

### 6.3 资源引用

不得在剧情中保存开发机器的绝对文件路径。

```json
{
  "assetId": "voice.alice.greeting_001"
}
```

Engine Adapter 负责将 AssetRef 解析为实际引擎资源。

---

## 7. Dialogue 数据

Dialogue 节点至少包含：

```ts
interface DialogueData {
  speaker: CharacterRef | Expression;
  text: LocalizedText;
  voice?: AssetRef;
  emotion?: string;
  portrait?: AssetRef;
  tags?: string[];
}
```

示例：

```json
{
  "speaker": { "characterId": "character.alice" },
  "text": { "default": "你好，旅行者。" },
  "voice": { "assetId": "voice.alice.greeting_001" },
  "emotion": "happy"
}
```

`emotion` 应引用角色配置中的情绪 ID。`portrait` 是可选覆盖项，没有设置时使用角色该情绪的默认立绘。

### 7.1 本地化

采用“开发期可内联、发布时可提取”的混合方式：

- 作者可以直接在 Dialogue 或 Choice 中编写默认语言文本。
- 每条可本地化文本拥有稳定 `textId`，不以原文作为 Key。
- Compiler 可以保留内联默认文本，也可以为发行构建提取独立本地化表。
- Runtime 优先请求 Adapter 按 `textId + locale` 解析文本，缺失时回退到内联默认文本。
- Voice 可以按语言映射到不同 AssetRef，Emotion 与语言无关。

```ts
interface LocalizedText {
  id: string;
  default: string;
}

interface LocalizedVoice {
  default?: AssetRef;
  locales?: Record<string, AssetRef>;
}
```

---

## 8. Ink 互操作

Ink 支持 choice、knot、stitch、divert、变量、条件、函数、循环、tag 和外部函数。Story Blueprint 使用 Ink tag 携带说话人、语音和情绪等元数据。

导出示例：

```ink
=== greeting ===

Alice: 你好。 # speaker:alice # voice:greeting_001 # emotion:happy

* [你好]
    -> friendly

* [离开]
    -> END
```

互操作分为两层：

1. Story Blueprint Ink 子集
   - 保证 `.story ⇄ .ink` 的语义双向转换，不保证文本、空白和排版逐字符一致。
   - 覆盖 Dialogue、Narration、Choice、Branch、变量、基础跳转和 End。

2. 任意 Ink
   - 可以导入为 Ink Block 并保留原始源码。
   - 可以交给 inkjs 执行。
   - 不保证 weave、thread、tunnel、复杂函数或自由布局能无损转换为可视节点。

Ink 是交换格式或可嵌入脚本格式，不取代 `.story` 主存储。

具体规则：

- Story Blueprint 是主要编辑方式，Ink 导入导出是辅助能力。
- 导出时用保留 Tag 写入稳定对象 ID，以及 speaker、voice、emotion、textId 等元数据。
- Tag 的名称、转义和重复规则形成版本化的 Ink Profile，不能依赖自由文本猜测。
- Ink 变量必须显式映射到 Story Blueprint 变量 ID、作用域和类型。
- 不受支持的结构默认整体保留为 Ink Block；禁止静默丢弃或擅自改写。
- 部分导入出现不支持结构时，先生成 Diagnostics 和预览，由用户选择取消或降级为 Ink Block。
- Ink Block 原始源码保持原样；一旦拆成可视节点，之后只保证语义等价。

参考：

- <https://github.com/inkle/ink/blob/master/Documentation/WritingWithInk.md>
- <https://github.com/inkle/ink/blob/master/Documentation/RunningYourInk.md>

---

## 9. `.story` 主存储格式

采用自定义 `.story` 扩展名，文件内容遵循 KDL 2.0。

选择 KDL 的原因：

- 面向节点的结构与蓝图数据自然匹配。
- 比 JSON 更紧凑。
- 支持属性、子节点和注释。
- 适合人工阅读和 Git diff。
- 已有正式语法及 TypeScript 解析器。
- 避免从零维护自定义 DSL 的词法、语法和格式化工具。

参考：

- <https://kdl.dev/>
- <https://kdl.dev/spec/>
- <https://www.npmjs.com/package/@bgotink/kdl>

### 9.1 完整示例

```kdl
story s_intro format=story-blueprint version=2 name=intro display-name=序章 {
  variables {
    variable v_favor name=favor display-name=好感度 type=number default=0
    variable v_name name=playerName display-name=玩家姓名 type=string default=Player
  }
  characters {
    character c_alice name=alice display-name=爱丽丝 {
      emotion happy display-name=开心
      emotion angry display-name=生气
    }
  }
  graph {
    story-entry n_start x=80 y=120 title=序章
    dialogue n_greet name=greeting x=320 y=120 speaker=c_alice emotion=happy {
      text "你好，{playerName}。"
    }
    branch n_check x=600 y=120 condition="favor >= 10"
    choice n_choose x=860 y=120 prompt=是否接受任务？ {
      option o_accept 接受任务 enabled-if="favor >= 10"
      option o_refuse 拒绝任务
    }
    end-story n_end x=1120 y=300 title=结束
    link n_start n_greet
    link n_greet n_check
    link n_check n_choose from=true
    link n_check n_end from=false
    link n_choose n_end from=o_accept
  }
}
```

这是当前不兼容旧格式的 `story-blueprint@2` writer 输出。项目尚处早期，不提供 v1 迁移或兼容读取。
节点、变量、角色、资源和选项使用短稳定 ID；节点 `name` 只有作者明确命名时才写入；Edge 不持久化 ID。

`.story` 是唯一权威编辑源，包含：

- 节点及其属性
- 动态端口项及其稳定 ID；静态端口由 Node Definition 派生
- 连线
- 取整后的节点坐标；编译产物不包含坐标
- Comment、Group、Reroute
- 编辑器需要持久化的其他信息

### 9.2 Schema、未知字段与稳定格式化

- `.story` 顶层必须包含格式版本，Node Definition 也必须带版本。
- Parser 直接建立当前 Source Model，不能让 UI 组件直接解释 KDL；当前版本明确不承担旧格式迁移。
- Writer 使用固定的字段排序、缩进、数字格式和集合排序规则，减少 Git Diff 噪声。
- 节点顺序不表达执行语义；执行顺序只由 Edge 和动态端口顺序决定。
- 对未来版本或插件产生的未知字段应尽量保留；当前 parser 在尚无无损编辑模型时会拒绝加载未知字段，防止覆盖保存。
- 注释的保留能力需要单独测试，不把“能解析 KDL”视为“能无损改写文件”。
- 自动生成的稳定 ID 不因移动、改名、复制文件或格式化而改变；Duplicate 操作必须生成新 ID。

---

## 10. Compiler 设计

Compiler 分为以下阶段：

```text
KDL Document
    ↓ Parse
Story Source Model
    ↓ Schema Validation
Typed Story Graph
    ↓ Graph Validation
Story AST
    ↓ Control-flow Lowering
Runtime Program
    ↓ Serialize
.storyc.json
```

Compiler 负责：

- 校验格式版本。
- 解析节点、端口和边。
- 检查端口方向与数据类型。
- 检查重复 ID、无效引用和非法连接。
- 检查 Entry、End 和 Return 的上下文。
- 检测不可达逻辑和意外死循环。
- 将表达式字符串解析为表达式 AST。
- 移除所有纯编辑器信息。
- 合并连续执行节点为基本逻辑块。
- 生成适合 Runtime 执行的指令和跳转。
- 可选生成源码映射。

---

## 11. Runtime 编译产物

编译产物不是“JSON 版本的节点图”。它只包含 Runtime 所需的逻辑程序。

建议扩展名：

```text
intro.storyc.json
intro.storyc.json.map
```

当前阶段固定使用 JSON，不实现自定义字节码，也不生成 TypeScript 剧情代码。原因是 JSON 更容易检查、测试、迁移和被 AI 工具理解；剧情执行性能由实际测量决定，未来可以在保持同一 Runtime Program 语义的前提下增加 CBOR 或字节码 Backend。

运行数据示例：

```json
{
  "format": "story-runtime",
  "version": 1,
  "entry": "main",
  "blocks": {
    "main": [
      {
        "op": "dialogue",
        "speaker": "alice",
        "text": "你好，旅行者。",
        "voice": "voice.alice.greeting_001",
        "emotion": "happy"
      },
      {
        "op": "branch",
        "condition": {
          "op": "and",
          "values": [
            {
              "op": ">=",
              "left": { "var": "favor" },
              "right": 10
            },
            { "var": "hasKey" }
          ]
        },
        "then": "trusted",
        "else": "normal"
      }
    ],
    "trusted": [
      {
        "op": "dialogue",
        "speaker": "alice",
        "text": "我相信你。",
        "emotion": "happy"
      },
      { "op": "end" }
    ],
    "normal": [
      {
        "op": "dialogue",
        "speaker": "alice",
        "text": "我们还不熟。",
        "emotion": "neutral"
      },
      { "op": "end" }
    ]
  }
}
```

### 11.1 编译产物必须移除

- 节点坐标和尺寸
- 输入、输出 Pin 描述
- Edge 对象
- 节点颜色和折叠状态
- 选中状态和视口状态
- Comment、Group、Reroute
- React 组件或插件 UI 名称
- MiniMap 等编辑器信息

### 11.2 Runtime 仍然需要

- 逻辑块 ID
- 跳转目标
- 指令类型和参数
- 条件表达式 AST
- 变量声明与初始值
- 角色和资源 ID
- Chapter 调用栈与 Return 指令

这里的逻辑块不是编辑器节点，而是 Compiler 生成的基本执行单元。

### 11.3 控制流约束

- Runtime Program 使用 `blockId + instructionIndex` 定位当前执行位置。
- Branch、Choice、Jump、Return 和 End 属于终结指令，必须位于逻辑块末尾。
- 非终结逻辑块必须显式 Jump，不允许依赖 JSON 对象顺序或数组结束后的隐式行为。
- Choice 的每个可见选项都必须携带稳定 `optionId` 和明确跳转目标。
- Call 指令记录目标 Chapter、参数、返回位置与可选返回值接收位置。
- Runtime Program 可以包含稳定的逻辑指令 ID 供存档和诊断使用，但它不是编辑器 Node ID，也不包含布局信息。
- Compiler 必须验证所有跳转目标、返回类型和终结路径。

### 11.4 可选源码映射

`.storyc.json.map` 可以记录运行指令与源节点之间的关系，用于：

- Runtime 报错定位
- 编辑器 Preview 高亮当前节点
- 断点和单步调试

源码映射不需要进入正式发行包。

---

## 12. TypeScript Runtime

Runtime 只解释编译后的 Story Program：

```ts
switch (instruction.op) {
  case 'dialogue':
    return adapter.showDialogue(instruction);

  case 'choice':
    return adapter.showChoices(instruction);

  case 'branch':
    currentBlock = evaluate(instruction.condition) ? instruction.then : instruction.else;
    break;

  case 'call':
    callStack.push(instruction.returnTo);
    currentBlock = instruction.target;
    break;

  case 'return':
    currentBlock = callStack.pop();
    break;

  case 'end':
    return finishStory();
}
```

Runtime 是可暂停、恢复和序列化的状态机：

```ts
interface RuntimeState {
  programId: string;
  programVersion: string;
  blockId: string;
  instructionIndex: number;
  callStack: CallFrame[];
  storyVariables: Record<string, RuntimeValue>;
  pending?: PendingInteraction;
  status: 'running' | 'waiting' | 'completed' | 'failed';
}
```

存档策略：

- 每条指令完成后形成稳定存档点。
- 等待 Choice 或外部事件时可以保存 PendingInteraction 和恢复所需的请求 ID。
- 不保存打字机进度、动画帧或语音播放位置；恢复时由 Adapter 重新呈现当前交互。
- 存档记录 Runtime Program 的内容版本；加载不兼容版本时必须先迁移或明确失败。
- Random 等非确定性功能必须保存随机种子或已经选定的结果。

### 12.1 Engine Adapter 契约

Adapter 使用异步、可取消接口：

```ts
interface StoryAdapter {
  showDialogue(request: DialogueRequest, signal: AbortSignal): Promise<void>;
  showChoice(request: ChoiceRequest, signal: AbortSignal): Promise<OptionId>;
  callEvent(request: EventRequest, signal: AbortSignal): Promise<RuntimeValue>;
  resolveText(textId: string, locale: string): Promise<string | undefined>;
  readExternalVariable(id: string): Promise<RuntimeValue>;
  writeExternalVariable(id: string, value: RuntimeValue): Promise<void>;
}
```

- Adapter 返回值必须经过 Runtime 类型和 ID 校验。
- 停止、切换存档或销毁 Story 时，Runtime 使用 AbortSignal 取消未完成请求。
- Event 必须在项目注册表中声明参数、返回类型、是否可存档恢复以及副作用类别。
- Adapter 错误统一转换为结构化 Runtime Diagnostic；Story 是否重试、跳转失败分支或终止由指令策略决定。
- Adapter 不能直接修改 Story Runtime 内部状态，只能通过返回值和外部变量接口交互。

Runtime 不负责：

- 对话框 UI
- 音频播放
- 资源加载
- 摄像机或动画
- 引擎对象访问

这些能力通过 Adapter 接口提供。

---

## 13. 文件职责总结

| 文件                | 格式                 | 是否权威源 | 用途                   |
| ------------------- | -------------------- | ---------: | ---------------------- |
| `*.story`           | KDL 2.0              |         是 | 编辑器完整工程数据     |
| `*.storyc.json`     | JSON Runtime Program |         否 | Runtime 执行逻辑       |
| `*.storyc.json.map` | JSON                 |         否 | 可选调试映射           |
| `*.ink`             | Ink                  |         否 | 导入、导出与 Ink Block |
| `*.character`       | KDL 2.0              |         是 | 可选独立角色资源       |
| `*.storyproject`    | KDL 2.0              |         是 | 项目级配置与资源索引   |

---

## 14. AI 编辑架构

AI 不直接模拟鼠标操作，也不直接修改 React Flow 状态或 KDL 文本。AI 通过结构化 Blueprint Command API 修改 Typed Story Graph，所有操作经过校验并作为可撤销事务执行。

```text
.story（KDL）
      ↓
Typed Story Graph（内存语义模型）
      ↕
AI Blueprint Command API
      ↓
Schema / Type / Connection Validation
      ↓
Diff Preview → Transaction → Undo / Redo
      ↓
保存 .story / 编译 .storyc.json
```

### 14.1 Blueprint Command API

基础命令包括：

- Add / Update / Remove Node
- Connect / Disconnect
- Add / Update Character
- Add / Update Variable
- Set Expression
- Create / Refactor Chapter
- Import / Export Ink
- Validate / Auto Layout

AI 应提交结构化命令，而不是直接拼接源文件：

```json
{
  "schemaVersion": 1,
  "command": "transaction",
  "operationId": "op_01J8...",
  "description": "增加接受和拒绝任务的分支",
  "baseRevision": 12,
  "dryRun": true,
  "operations": [
    {
      "op": "addChoice",
      "id": "quest_choice",
      "prompt": "是否接受任务？",
      "options": [
        { "id": "accept", "text": "接受" },
        { "id": "refuse", "text": "拒绝" }
      ]
    },
    {
      "op": "connect",
      "from": "quest_intro.out",
      "to": "quest_choice.in"
    }
  ]
}
```

每次 AI 修改必须：

- 通过 JSON Schema、端口和数据类型校验。
- 携带基础 Revision，避免覆盖用户的新修改。
- 先生成 Diff Preview，再由用户确认或按策略自动执行。
- 作为单个 Transaction 进入 Undo / Redo 历史。
- 返回结构化 Diagnostics，而不是只返回自然语言错误。
- 高亮新增、修改和删除的节点及资源。
- 支持前置条件，例如“仅当当前连接仍指向指定节点时才执行”。
- 任一操作失败时整笔回滚，不允许留下半完成事务。
- 删除或改型角色、变量、Chapter 和资源前执行引用检查。
- 语义 Diff 与布局 Diff 分开呈现；自动布局默认只移动 AI 新建节点。

命令协议以通用原语为核心，例如 `addNode`、`setProperty`、`connect` 和 `removeResource`。`addChoice`、`extractChapter` 等属于可选高级命令，最终仍展开为同一套可校验事务。

确认策略：

- 修改单句文本、补充标签等低风险局部操作可以自动执行，并进入 Undo 历史。
- 删除、批量修改、Chapter 重构、变量改型和控制流改写必须先展示 Diff Preview。
- 用户可以在项目设置中提高确认级别，但不能关闭 Schema、类型、引用和 Revision 校验。

### 14.2 AI 语义视图

AI 通常不需要节点坐标、颜色、视口和折叠状态。编辑器应按当前 Chapter 或选中范围生成精简语义视图：

```json
{
  "chapter": "quest_intro",
  "revision": 12,
  "characters": ["alice", "player"],
  "variables": {
    "favor": "number",
    "hasKey": "boolean"
  },
  "flow": [
    {
      "id": "greeting",
      "type": "dialogue",
      "speaker": "alice",
      "text": "你好。",
      "next": "check_favor"
    },
    {
      "id": "check_favor",
      "type": "branch",
      "condition": "favor >= 10",
      "true": "trusted",
      "false": "normal"
    }
  ]
}
```

编辑器负责把语义修改转换为真实节点、端口和边，并自动布局新增内容，同时尽量保持用户已有布局。

### 14.3 稳定 ID

AI、Compiler、Source Map 和协作功能都依赖稳定 ID。禁止使用数组下标、显示文字或画布位置作为引用。

```text
不稳定：nodes[14]
不稳定：角色“爱丽丝”的第二句对话
稳定：node_01J8R6M2K7...（name: alice_greeting）
```

对象应保留稳定 ID、可读名称、Revision，以及可选的创建来源（user / ai / import）。

### 14.4 Revision 与冲突

- 每个事务携带 `baseRevision`，只在语义模型版本匹配时提交。
- Revision 冲突时不自动覆盖用户的新修改，而是重新获取局部语义视图并重放或请求确认。
- `operationId` 用于去重，重复提交同一操作不能产生重复节点。
- AI Command Schema、Story Source Schema 和 Runtime Program Schema 分别版本化，不能共用一个模糊的全局版本号。

---

## 15. 推荐实现顺序

1. 定义稳定 ID 规则、版本化 `.story` Schema、Node Definition 和 TypeScript Source Model。
2. 同时定义 Runtime Program Schema、RuntimeState 和 Adapter 契约，固定编译两端的语义。
3. 引入 KDL 2.0 Parser，实现读取、写入、未知字段保护和稳定格式化。
4. 实现端口类型与连接校验。
5. 实现节点创建、删除、选择、剪贴板和 Undo / Redo。
6. 实现 Blackboard、变量作用域、CharacterDefinition 和本地化文本 ID。
7. 实现 Scratch 风格表达式 AST、符号绑定和编辑器。
8. 定义 Blueprint Command API、Revision、Transaction 和 Diff 机制。
9. 实现 Compiler：Graph → Story AST → JSON Runtime Program。
10. 实现最小 TypeScript Runtime 状态机与 Adapter。
11. 实现 `.story` 保存、打开、稳定点存档与 Runtime Preview。
12. 实现 AI 语义视图、风险分级确认和结构化 Diagnostics。
13. 实现版本化 Ink Profile、受支持子集的语义导入导出和 Ink Block 降级。
