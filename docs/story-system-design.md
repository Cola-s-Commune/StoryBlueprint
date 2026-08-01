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

| 节点         | 用途                     | 执行输入 | 执行输出             |
| ------------ | ------------------------ | -------: | -------------------- |
| Story Entry  | 根 Story 入口            |        0 | Next                 |
| Dialogue     | 显示角色对话             |        1 | Next                 |
| Narration    | 显示无说话人的旁白       |        1 | Next                 |
| Choice       | 等待玩家选择             |        1 | 每个选项一个动态输出 |
| Branch       | 根据布尔表达式自动分流   |        1 | True / False         |
| Set Variable | 修改 Story 变量          |        1 | Next                 |
| Call Event   | 向 Adapter 派发游戏事件  |        1 | Next                 |
| Wait Signal  | 等待引擎发送项目 Signal  |        1 | Received             |
| Call Chapter | 调用可复用 Chapter       |        1 | Completed            |
| End Story    | 结束整个 Story 实例      |        1 | 0                    |
| Return       | 从 Chapter 返回调用点    |        1 | 0                    |
| Reroute      | 整理连线，不产生运行指令 |        1 | 1                    |
| Flow Jump    | 跳转到同图 Flow Anchor   |        1 | 0                    |
| Flow Anchor  | 标记同图跳转的继续位置   |        0 | 1                    |
| Comment      | 编辑器注释，不参与运行   |        0 | 0                    |

### 3.2 后续节点

- Switch
- Sequence
- Random
- Wait Signal（已实现）
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
- 作者从已占用的普通执行输出重新连线时，编辑器原子替换旧连线；文件解析与 Compiler 仍把实际存在的多后继视为错误。
- 多路执行必须通过 Choice、Branch、Sequence 等明确节点表达。
- Pin 快捷操作与 UE Blueprint 对齐：Alt+左键点击 Pin 断开该 Pin 的全部连线；Ctrl+左键从已连接 Pin 拖到同方向兼容 Pin，原子转移全部连线。两者都进入 Undo 历史。
- Alt+左键点击 Wire 只断开被点击的单条连线，与 Alt+点击 Pin 的“全部断开”语义明确区分。
- Graph 左上提供可展开的快捷键说明，且根据当前 Blueprint / Standard 操作模式显示对应的框选和平移方式。
- Shift+框选与已有节点选择取并集；多选外框不阻断 Blueprint 模式的右键平移，Ctrl+左键可穿透外框切换单个节点的选择状态，并同步更新相关内部连线。AI Dry Run 后使用独立 Proposal Graph 覆盖预览，空白点击和节点移动都不会写入 Story；只有显式 Apply 才提交，Discard 直接丢弃。
- 编辑器窗口支持 Ctrl++、Ctrl+-、Ctrl+0 全局缩放，快捷键由 Electron 窗口层处理，输入框和 Monaco 聚焦时同样有效；View 菜单提供等价操作。
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
- Graph 提供 Layout Selected 与 Layout All：只按执行连线从左到右分层，数据连线不改变叙事顺序；列间距取该列最大实测宽度，行间距逐个累加节点实测高度，长 Dialogue 不得重叠。局部整理不得移动选区外节点。AI Proposal 状态下只整理新增预览节点，不隐式 Apply。
- Ctrl+F 打开当前 Story 搜索，索引 Main Story、全部 Substory 的节点名、Dialogue Line、Choice Option，以及 Variable、Character、Asset、Event、Signal。节点结果解析资源显示名，因此搜索角色名也能命中其 Dialogue 使用处；点击结果切换 Graph、选中并聚焦节点，资源结果则打开右侧 Inspector。
- 支持 Reroute 和 Comment 整理大型蓝图。

### 4.5 长连线与循环整理

- 双击执行连线会在点击位置插入 Reroute；右键连线也可显式选择 Insert Reroute。Reroute 显示为单个 Knot，并根据相邻节点位于左侧还是右侧选择端口，让横向蓝图的回线穿过 Knot，避免小折返或 T 形短杆。
- Auto Layout 计算故事层级时穿透 Reroute，不把视觉 Knot 当作额外剧情步骤；前向 Reroute 在端点之间插值排列，回线 Reroute 使用图下方的独立布线路径，避免长线横穿节点主体。
- 右键执行连线选择 Convert to Flow Portal 后，原连线替换为靠近源端的 Flow Jump 和靠近目标端的 Flow Anchor。
- Flow Jump 通过稳定 `targetNodeId` 引用同一 Graph 内的 Flow Anchor；Anchor 的显示标签可以修改，不参与引用身份。
- Flow Jump 和 Flow Anchor 不使用一条永久跨画布长线。选中任一端时，编辑器临时显示虚拟虚线，并支持双击 Jump 定位 Anchor。
- 删除 Anchor 时，仍存在的 Jump 会清空目标并显示未配置状态；保存允许保留这种编辑中状态，Compiler 会给出可定位错误。
- 复制 Jump 和 Anchor 时，如果两者同时在选区内，粘贴会把 Jump 重映射到新 Anchor；只复制 Jump 时保留原图目标。
- 第一阶段 Portal 只允许同一 Main Story 或同一 Substory Graph 内跳转。跨 Substory 流程继续使用 Call Substory / Return，避免绕过调用栈。
- 含 Flow Jump 或 Flow Anchor 的选区暂不允许直接提取为 Substory，直到提取重构能够显式处理跨边界 Portal。
- Compiler 将 Reroute 直接折叠，将 Flow Jump → Flow Anchor → 后继降级为普通 Runtime Jump；Reroute、Anchor、坐标和虚拟连线均不进入 `.storyc.json`。

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

Story Data 左侧只负责资源列表、搜索和拖拽；点击变量、角色或资产后，其详细编辑表单显示在右侧 Inspector，与节点属性共用统一的属性编辑区域。选择资源时清除当前节点选择，选择节点后 Inspector 优先显示节点属性。

变量、角色和资产的脚本 Name 采用草稿编辑：输入过程中可以暂时为空，只有 Enter 或失焦时才提交；最终为空或按 Esc 时恢复进入编辑前的名称，不产生无效资源状态，也不触发文件重命名。变量和角色的 Name 确认修改时，Display Name 默认同步为新名称，之后仍可单独编辑展示名称。

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

修改角色脚本 Name 时，编辑器默认让 Display Name 同步变化；作者仍可随后单独修改 Display Name。项目模式下角色文件在创建时采用 `<initial-name>-<id-suffix>.character`，之后修改 Name 或 Display Name 都不移动文件。稳定 ID、项目索引路径和所有 Story 引用保持不变；未来需要整理磁盘名称时，通过独立的 Rename File 操作完成。

情绪不是逗号分隔的标签，而是角色下的结构化资源。每项拥有稳定 Key、面向作者的 Display Name 和可选 Portrait；修改 Key 会同步更新所有已打开 Story 的 Dialogue Line 引用，删除前需要确认并清除对应引用。情绪 Portrait 未配置时回退到角色 Default Portrait；Dialogue 未指定情绪时同样使用 Default Portrait。Compiler 将最终 Portrait Asset ID 固化到 Dialogue 指令，Engine Adapter 只负责把该 ID 解析为引擎资源。

对话中的说话人既可以是固定 CharacterRef，也可以由表达式动态决定。

### 6.3 资源引用

不得在剧情中保存开发机器的绝对文件路径。

```json
{
  "assetId": "voice.alice.greeting_001"
}
```

Engine Adapter 负责将 AssetRef 解析为实际引擎资源。

### 6.4 项目事件

Event Definition 保存在 `.storyproject`，由同一项目内的 Story 共享。事件表展示稳定 Event ID、Name、
Display Name、参数签名和 Description；Description 应说明调用时机与引擎 Handler 的职责。
同一张事件表进入 node-free 编译项目清单，供引擎程序直接据此实现 Adapter。名称和说明变化不改变节点引用。第一阶段参数支持 Boolean、Number、String，Call Event
节点使用与 Branch / Set Variable 相同的 Typed Expression 输入，因此 Literal、变量和组合表达式不需要
展开成大量数据节点。参数重命名会同步改写已打开 Story 中对应的参数键。

Call Event 是单向命令：Compiler 将参数表达式编译为 Typed Expression；Runtime 求值后产生
EventRequest，Adapter 将其派发给引擎后故事立即继续。故事不观察引擎工作的完成、返回值或失败状态，
因此节点只有 `Next` 输出，也没有 Fire-and-forget / Wait for Completion 模式开关。

需要显式同步时使用独立的 Wait for Signal。Signal Definition 与 Event 一样保存在 `.storyproject`，包含
稳定 ID、Name、Display Name、Description 和 Boolean / Number / String 参数 Schema。引擎发送 Signal
时附带完整 Payload；Wait 节点可对任意参数选择 `Any value`，或填写 Literal / Variable / Expression
作为期望值。所有启用的参数过滤器按 AND 组合，Runtime 消费同一 Signal ID 下第一条匹配 Payload。

过滤表达式在到达 Wait 节点时求值一次，求值结果随 PendingInteraction 存档。RuntimeState 保存提前到达
和未匹配的完整 Payload 队列，因而通知早于 Wait 到达不会丢失，其他 Payload 也不会被错误消费。首版
只对稳定标量使用严格相等匹配；CharacterRef、AssetRef 和复杂 JSON 等有明确需求后再扩展。

编辑器还提供独立的 Project Interface Table 人类视图，列出 Event / Signal 的稳定 ID 和 Description，
并可复制为 Markdown 交给引擎程序员。该视图是接口文档，不以 Runtime 调试界面或机器 JSON 代替。

当前 Side Effect 元数据不参与 Runtime 行为，且 None / Read / Write 对动画、UI 等事件语义含糊，因此不在
作者界面和人类接口表中展示。未来只有在安全策略、重放或静态分析真正使用它时，才考虑以
Pure / Query / Command 等更明确的模型重新开放。

---

## 7. Dialogue 数据

Dialogue 节点表示一个没有中间控制流的连续对话段。节点本身只组织 Line，不保存说话人、
情绪或语音默认值；每条 Line 独立拥有完整语义：

```ts
interface DialogueData {
  lines: DialogueLine[];
}

interface DialogueLine {
  id: DialogueLineId;
  textId: TextId;
  text: TextTemplateSource;
  speakerId?: CharacterId;
  voiceId?: AssetId;
  emotion?: string;
  tags?: string[];
}
```

Line 未填写 `speakerId` 时明确表示 Narrator，未填写 voice 或 emotion 时表示该句没有指定值，
不存在节点级继承。节点只有一个执行入口和一个执行出口；
Compiler 将 Line 按作者顺序降级为连续 Dialogue 指令，每句都形成独立暂停点。Choice、Branch、
Event 或变量修改不能插入 Line 列表，遇到这些控制边界时必须拆成多个节点。

```kdl
dialogue n_greet {
  line ln_hello t_hello "你好，{playerName}。" speaker=c_alice voice=a_greeting emotion=happy {
    tag greeting
  }
  line ln_warning t_warning "不过，前面的路并不安全。" speaker=c_alice emotion=serious
}
```

Inspector 支持新增、复制、删除、上下移动和拖动排序；复制 Line 或整个 Dialogue 时必须重新生成
Line ID 和 Text ID。新增 Line 可复制上一句的 Speaker / Emotion / Voice 作为编辑便利，但这些值
立即写入新 Line，并非继承。Line 卡片默认折叠为说话人与台词摘要，按需展开完整属性；每条摘要可直接跳到
Monaco 中一一对应的 Ink 物理行。画布只展示前三句及剩余总数，每句预览最多两行，完整内容在 Inspector 中编辑。
v3 只接受 `line` 结构，旧单 `text` Dialogue 与节点级默认属性均明确拒绝。

选中两个以上 Dialogue 节点时，只有它们构成无分支、无中段外部连线的连续执行链才允许合并；
合并按执行顺序拼接 Line，并保留原有 Line ID / Text ID。单个 Dialogue 的 Lines 视图允许勾选
若干 Line 拆分，编辑器按“选中 / 未选中”的连续区段生成 Dialogue 链，因此选择中间或不相邻的
Line 也不会改变运行时播放顺序。合并和拆分都作为单个 Undo 事务。

`emotion` 应引用最终说话人配置中的情绪 ID。Compiler 优先解析该情绪的 Portrait，未配置时回退到角色 Default Portrait，并把最终 Asset ID 写入无节点的 Dialogue 指令。

### 7.1 Dialogue Ink 编辑视图

Inspector 为同一份 `DialogueData.lines` 提供 `Lines` 与 Monaco `Ink` 两种视图。Lines 始终是
节点的唯一权威数据；Ink 是可编辑投影，不作为第二份源数据保存。结构化新增、删除、排序或修改
Line 后，Ink 文本立即重建。离开 Ink 视图时，无诊断草稿会作为一次可撤销事务写回 Lines 并保存
Story，不提供独立 Apply 按钮；切回 Lines 时若存在错误则保持在 Monaco 中且不污染节点。

当前编辑视图采用 Dialogue 专用 Ink Profile：一个物理行严格对应一个 Dialogue Line。每行必须以
`Character: ` 或 `Narrator: ` 开头；说话人按唯一 `name` / `displayName` 解析，规范输出优先使用
不重名的显示名。行尾可使用 `# emotion:<emotion-name>`、`# voice:<audio-asset-name>`，其他 Ink Tag
写入 `tags`。行尾 `# speaker:...` 属于错误，不提供旧格式兼容或迁移。文本中的换行编码为 `\n`，Tag 起始符
可写成 `\#`。解析时优先按稳定的资源 `name` 匹配，也接受唯一的 `displayName`；未知或重名资源
产生可定位、可复制的诊断。重排和仅修改内容时尽量保留原 Line ID / Text ID，新增内容生成新 ID。

Choice、divert、knot 等完整 Ink 控制语法不能写入 Dialogue 节点；它们属于后续 Ink Block 或
Ink-to-Nodes 转换能力。这样批量写对白可以立即使用 Monaco，同时不与完整 Ink Runtime 路线冲突。

### 7.2 Choice Option 与 Ink 编辑视图

Choice Option 使用与 Dialogue Line 一致的 Inspector 交互：卡片默认显示序号和文本摘要，可展开编辑
Text Template、Visible If 与 Enabled If，也可新增、复制、删除、按钮移动或拖动排序。每个 Option
继续使用稳定 Option ID 作为动态输出端口身份；删除 Option 必须在同一可撤销事务中删除对应输出连线。

Choice Monaco 投影的第一行是 Prompt，后续每行使用 Ink 的 `* ` Choice 形式表示一个 Option。
`# visible-if:<expression>` 与 `# enabled-if:<expression>` 是 Story Blueprint Choice Profile 的扩展标签。
结构化 Option 是唯一权威数据；离开 Monaco 时有效草稿自动写回并保存，整次应用可通过一次蓝图 Undo
恢复。Option 摘要可直接定位到对应 Ink 行，文本编辑和重排时尽量保持稳定 Option ID 与已有连线。

### 7.3 本地化

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

Alice: 你好。 # voice:greeting_001 # emotion:happy

* [你好]
    -> friendly

* [离开]
    -> END
```

互操作分为两条可共存的路线：

1. 完整运行 Ink Block
   - Linked Ink 引用项目内 `.ink`，外部文件是权威来源；Embedded Ink 将源码保存在 `.story`。
   - 直接交给完整 Ink Runtime 执行，不要求先转换成原生节点。
   - 通过变量桥接和 Event Adapter 与 Story Runtime、游戏引擎交互。

2. Ink 节点转换
   - 长期目标是把完整 Ink 语义转换为可视节点；连续台词合并为多 Line Dialogue。
   - 转换覆盖率可以渐进增加，暂未覆盖的局部结构继续保留为可运行 Ink Block。
   - `.story ⇄ .ink` 只承诺语义等价，不承诺原始空白、排版和注释位置不变。

Ink 是交换格式或可嵌入脚本格式，不取代 `.story` 主存储。

具体规则：

- Story Blueprint 是主要编辑方式，Ink 导入导出是辅助能力。
- 导出时用保留 Tag 写入稳定对象 ID，以及 speaker、voice、emotion、textId 等元数据。
- Tag 的名称、转义和重复规则形成版本化的 Ink Profile，不能依赖自由文本猜测。
- Ink 变量必须显式映射到 Story Blueprint 变量 ID、作用域和类型。
- 暂未覆盖的结构默认整体保留为 Ink Block；禁止静默丢弃或擅自改写。
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
story s_intro format=story-blueprint version=4 name=intro display-name=序章 {
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
    story-entry n_start title=序章
    dialogue n_greet name=greeting {
      line ln_greeting t_greeting "你好，{playerName}。" speaker=c_alice emotion=happy
    }
    branch n_check condition="favor >= 10"
    choice n_choose prompt=是否接受任务？ {
      option o_accept 接受任务 enabled-if="favor >= 10"
      option o_refuse 拒绝任务
    }
    end-story n_end title=结束
    link n_start n_greet
    link n_greet n_check
    link n_check n_choose from=true
    link n_check n_end from=false
    link n_choose n_end from=o_accept
    layout {
      position n_start x=80 y=120
      position n_greet x=320 y=120
      position n_check x=600 y=120
      position n_choose x=860 y=120
      position n_end x=1120 y=300
    }
  }
}
```

这是当前不兼容旧格式的 `story-blueprint@4` writer 输出。项目尚处早期，不提供旧版本迁移或兼容读取。节点逻辑与 `layout` 坐标分区保存，使内容修改和画布移动落在不同的 Git Diff 区域。
节点、变量、角色、资源和选项使用短稳定 ID；节点 `name` 只有作者明确命名时才写入；Edge 不持久化 ID。

`.story` 是唯一权威编辑源，包含：

- 节点及其属性
- 动态端口项及其稳定 ID；静态端口由 Node Definition 派生
- 连线
- 取整后的节点坐标；编译产物不包含坐标
- Comment、Group、Reroute
- Flow Jump / Flow Anchor 的同图稳定引用
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

项目构建产物使用扩展名：

```text
my-project.storyc.json
my-project.storyc.json.map
```

当前阶段固定使用 JSON，不实现自定义字节码，也不生成 TypeScript 剧情代码。原因是 JSON 更容易检查、测试、迁移和被 AI 工具理解；剧情执行性能由实际测量决定，未来可以在保持同一 Runtime Program 语义的前提下增加 CBOR 或字节码 Backend。

当前 `.storyc.json` 是版本化的项目容器，记录项目 ID、稳定内容版本、默认入口 Story 与 Story → Runtime Program 表。每个 Runtime Program 仍然是无节点、无坐标、无编辑器状态的纯逻辑；项目容器额外携带运行时解析说话人、语音和肖像所需的角色与资产表。Runtime 可从 JSON 解析整个项目，再按默认入口或指定 Story 创建执行器。

项目构建前会保存脏 Story、同步项目索引，并检查断裂连线、不可达节点、多入口、End / Return 上下文、无暂停点循环及现有表达式和 Runtime Program 约束。Diagnostics 保留 Story、Substory 和源节点定位，但这些定位信息只存在于编辑器 Problems 结果中，不写入默认运行产物。

编辑器呈现的错误、警告、路径与诊断正文必须允许直接选择文本。Problems 面板提供 Copy All，将严重级别、错误码、正文以及 Story、文件、Substory、Node 定位整理成纯文本；运行预览、工作区、画布临时错误和状态栏文档错误提供就近 Copy，便于作者粘贴到 Issue、聊天或 AI 上下文中。

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
- Flow Anchor 和编辑器虚拟 Portal 连线
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
- 等待 Choice 或 Signal 时可以保存 PendingInteraction 和恢复所需的请求 ID；提前到达的 Signal 缓冲也属于存档状态。
- 不保存打字机进度、动画帧或语音播放位置；恢复时由 Adapter 重新呈现当前交互。
- 存档记录 Runtime Program 的内容版本；加载不兼容版本时必须先迁移或明确失败。
- Random 等非确定性功能必须保存随机种子或已经选定的结果。

编辑器 Runtime Preview 提供一个按 Program ID 隔离的本地验证槽，以及 `Save State`、`Load State`、
`Copy State` 操作。加载必须创建新的 Runtime 实例，不能复用旧执行器；当前编辑内容通过确定性指纹生成
Content Version，因此蓝图、资源或项目接口变化后，旧槽会返回可复制的版本不兼容诊断。该槽只用于
验证 Runtime 契约，最终游戏仍由引擎存档系统持有 RuntimeState。

### 12.1 Engine Adapter 契约

Adapter 使用异步、可取消接口：

```ts
interface StoryAdapter {
  showDialogue(request: DialogueRequest, signal: AbortSignal): Promise<void>;
  showChoice(request: ChoiceRequest, signal: AbortSignal): Promise<OptionId>;
  callEvent(request: EventRequest, signal: AbortSignal): Promise<void>;
  waitForSignal(request: SignalRequest, signal: AbortSignal): Promise<SignalPayload>;
  resolveText(textId: string, locale: string): Promise<string | undefined>;
  readExternalVariable(id: string): Promise<RuntimeValue>;
  writeExternalVariable(id: string, value: RuntimeValue): Promise<void>;
}
```

- Choice 等 Adapter 返回值必须经过 Runtime 类型和 ID 校验。
- 停止、切换存档或销毁 Story 时，Runtime 使用 AbortSignal 取消未完成请求。
- Event 与 Signal 必须在项目接口表中声明；Event 是单向命令，Signal 是唯一的外部同步点。
- Adapter 派发或等待错误统一转换为结构化 Runtime Diagnostic。
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

编辑器工作区可以同时打开多个独立的 Story 资源。每个 `*.story` 仍是独立权威源，包含自己的 Main Story、Substory 和变量。单文件模式允许角色与资产继续内嵌在 `.story` 中；项目模式的新角色和资产则使用独立资源文件，Story 节点只保存稳定 ID 引用，不复制项目资源定义。

编辑器采用类似 VS Code 的目录工作区：用户选择一个真实文件夹作为根目录，Explorer 递归展示其中的子目录与 `*.story`，Open Stories 单独表示已经加载到编辑会话的资源。工作区根目录可以包含一个 `*.storyproject`，作为项目稳定身份和语义索引；没有项目文件的普通目录仍可临时打开，但不能提供完整的跨 Story 资源视图。

编辑器首次启动时保持空会话，不隐式创建 Untitled Story。欢迎页要求用户明确新建项目、打开项目或打开单个 Story；关闭最后一个 Story 后回到欢迎页。后续启动会恢复上次工作目录、已打开 Story 和活动 Story。新建项目通过原生保存对话框创建 `*.storyproject` 并将其父目录设为工作区，打开项目则直接选择 `*.storyproject`。Save Project 会重新扫描并写入项目索引；Ctrl+S 优先保存当前 Story，没有活动 Story 时保存当前项目，Save All 保存所有脏 Story。

新建项目还会在工作目录缺少 `.gitignore` 时写入保守模板：忽略生成的 `*.storyc.json`、操作系统文件与本地编辑器配置，但不忽略 `.storyproject`、`.story`、`.character`、`.asset` 和 `.ink` 等源资源。若目录已有 `.gitignore`，编辑器保持其内容不变。

项目区域同时显示当前工作目录的 Git 覆盖状态。检测使用 Git 仓库根目录而非仅检查工作目录内的 `.git`，所以父级仓库中的项目不会被错误地重复初始化；未受版本控制时可显式创建以 `main` 为初始分支的仓库并补齐缺失的 `.gitignore`。初始化只创建仓库，不自动提交或暂存文件。

编辑器周期性检查当前分支、detached HEAD 位置和 Git Index 未合并条目，而不把同一分支上的普通提交视为工作区切换。检测到外部切换或 merge/rebase 进入、退出冲突状态后，重新扫描项目文件、共享资源，并按原标签集合从 Git Local Stage 或新分支重载已打开 Story；新分支不存在的 Story 会关闭并报告。当前活动 Story 和仍存在的 Substory 视图尽量保留。若存在未保存的 Story 或项目资源编辑，必须先明确选择丢弃并重载或保留编辑，禁止静默覆盖。

Story Merge 将节点 `position` 视为 `{ x, y }` 原子值，不把同一节点拆成两个坐标冲突。坐标冲突提供四种批量策略：保留 Local、保留 Remote、Local 顺序优先局部整理、Remote 顺序优先局部整理。局部整理包含冲突节点及其一步直连的非 Rerouter 邻居，不穿透 Rerouter，也不影响 Runtime 逻辑。

AI 语义接口不暴露坐标写入。需要整理画布时，AI 使用 `layout-selection` 指定准确节点集合，或使用 `layout-neighborhood` 指定种子节点并扩展到一步直连的非 Rerouter 邻居。Command Executor 返回布局意图，编辑器用当前节点尺寸生成 Proposal；作者仍可移动每个预览节点，再决定 Apply 或取消。

远端自动合并进来的新增节点若与本地已有节点发生视觉重叠，编辑器会依据节点宽高和相邻流程锚点，只移动发生碰撞的新增节点。未碰撞的新增节点保留作者坐标。

新建项目时同时创建一个 `main.story`（若重名则使用递增后缀），将其设为项目入口并直接打开。这样项目创建后立即具有可编辑、可运行的 Main Story，而不是空项目索引。

自动恢复不直接覆盖源 `*.story`。编辑器把脏 Story 的完整文本延迟写入用户数据目录中的独立恢复区；正常保存或明确丢弃后清除，异常退出后的下次启动由用户选择恢复或丢弃。

`*.storyproject` 当前保存：

- 项目稳定 ID、Name 与 Display Name。
- 所有 Story 的稳定 ID、相对路径、Name 与 Display Name。
- 角色和资产的稳定 ID、独立资源相对路径，以及每项资源被哪些 Story 使用。
- Asset 的类型、语言映射与资源路径。

项目索引可由编辑器重新扫描并稳定生成；新增、保存 Story 或修改资源后自动同步，也可在 Explorer 中手动同步。项目角色默认写入 `Characters/*.character`，项目资产默认写入 `Assets/*.asset`，二者都使用紧凑、版本化的 KDL。角色可引用默认肖像和情绪肖像，资产可声明类型以及 `default` 与各 Locale 的资源路径。

独立资源和内嵌资源共享同一套稳定 ID 语义。同步时拒绝重复 ID、重复脚本名称、路径逃逸、缺失的说话人或语音、指向非 Portrait 资产的肖像，以及独立定义和 Story 内嵌定义的冲突。删除共享资源前，主进程通过项目索引检查已保存 Story，编辑器同时扫描所有已打开 Story 的当前内存图检查未保存引用；未保存但无关的修改不会阻止删除。

`.story` KDL 结构层允许 Dialogue 和 Character 保存未内嵌定义的 Character/Asset ID，因为这些定义可能来自 `.storyproject` 注册的独立资源。资源是否真实存在、类型是否正确由项目同步和 Compiler 在拥有完整项目上下文时诊断；变量与 Substory 属于 Story 内部定义，仍在 KDL 读写时执行严格引用校验。

编辑器中的项目资源修改按顺序即时落盘，Save All 与项目切换会等待资源写入结束。编译项目时只把项目索引判定为该 Story 实际使用的共享资源合并进编译输入；编译产物仍只包含 Runtime 所需的角色、资产和逻辑，不包含资源文件路径或编辑器节点信息。

Explorer 为项目、Story、角色和资产提供“在文件管理器中显示”与显式删除操作。关闭 Story 只关闭编辑标签，不删除文件；删除 Story 会同时关闭对应标签。删除 `.storyproject` 只移除项目索引，保留目录中的 Story、角色和资产。所有删除都需要确认，角色与资产仍必须通过引用检查。

项目角色删除由主进程统一显示原生 `Delete / Cancel` 确认框，Inspector 与 Explorer 不各自实现文件删除。取消不会进入删除队列的后续步骤，不清除当前角色选择，也不修改项目文件。

渲染进程不直接访问文件系统。目录扫描、按相对路径打开、新建文件夹和新建 Story 均通过主进程 IPC，并在解析路径及符号链接后校验目标仍位于当前工作目录内。

| 文件                | 格式                 | 是否权威源 | 用途                                    |
| ------------------- | -------------------- | ---------: | --------------------------------------- |
| `*.story`           | KDL 2.0              |         是 | 单个 Story 完整源数据                   |
| `*.storyc.json`     | JSON Runtime Program |         否 | Runtime 执行逻辑                        |
| `*.storyc.json.map` | JSON                 |         否 | 可选调试映射                            |
| `*.ink`             | Ink                  |         否 | 导入、导出与 Ink Block                  |
| `*.character`       | KDL 2.0              |         是 | 项目级共享角色、情绪与肖像映射          |
| `*.asset`           | KDL 2.0              |         是 | 项目级共享资产、类型与语言路径映射      |
| `*.storyproject`    | KDL 2.0              |         是 | 项目身份、Story 清单与跨 Story 资源索引 |

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
  "format": "story-blueprint-commands",
  "version": 1,
  "baseRevision": "rev_1k8m4zr",
  "operations": [
    {
      "operationId": "disconnect-old-next",
      "kind": "disconnect",
      "graph": { "kind": "root" },
      "from": { "nodeId": "n_quest_intro", "portId": "out" },
      "to": { "nodeId": "n_quest_next", "portId": "in" }
    },
    {
      "operationId": "add-warning",
      "kind": "add-node",
      "graph": { "kind": "root" },
      "node": {
        "id": "n_quest_warning",
        "type": "dialogue",
        "data": {
          "lines": [
            {
              "id": "ln_quest_warning",
              "textId": "t_quest_warning",
              "text": { "source": "前方可能很危险。" }
            }
          ]
        }
      }
    },
    {
      "operationId": "connect-warning",
      "kind": "connect",
      "graph": { "kind": "root" },
      "from": { "nodeId": "n_quest_intro", "portId": "out" },
      "to": { "nodeId": "n_quest_warning", "portId": "in" }
    },
    {
      "operationId": "connect-next",
      "kind": "connect",
      "graph": { "kind": "root" },
      "from": { "nodeId": "n_quest_warning", "portId": "out" },
      "to": { "nodeId": "n_quest_next", "portId": "in" }
    }
  ]
}
```

第一版已实现无坐标 Semantic Snapshot，以及 `add-node`、`update-node`、`remove-node`、`connect`、
`disconnect` 原语。命令执行器只在 Story 副本上工作：先校验不可信 JSON 形状和基础 Revision，再逐条验证
节点、端口与连接，最后验证 Source Schema。Editor Store 在应用前追加 Compiler 校验，并将成功提交记录为
一个 Undo 检查点；Dry Run 只返回候选文档和新 Revision，不修改 Store。

当前 Editor 历史只保存活动 Graph，因此第一版提交明确限制所有 Operation 指向同一个活动 Graph。纯数据
执行器可以预演跨 Graph 事务，但在整份 Story 原子历史快照完成前，Editor 不允许提交跨 Chapter 修改。
该限制防止“命令执行成功但 Undo 只能撤销其中一部分”。

编辑器通过可停靠的 AI Commands 面板同时提供内置生成与手动桥接。内置 Provider 第一版使用
OpenAI-compatible Chat Completions 接口，可选择选中节点、当前 Graph 或整个 Story 作为上下文；选中范围额外包含
一跳边界节点，让模型看见原有入口和出口。模型响应会自动填入命令区并执行 Dry Run，绝不会直接修改 Story；
作者查看节点和连线的语义 Diff 后仍需手动 Apply。验证失败可携带结构化诊断自动重试，生成中的请求可取消。
手动流程仍允许复制 AI Context、调用任意外部模型并粘贴单个 JSON 事务。

AI Commands 同时是会话式 Story Assistant，而非只能生成命令的单次表单。每轮请求都重新附加所选范围的最新
Semantic Snapshot；默认范围为整个 Story，也可收窄到活动 Graph 或选中节点及其一跳边界。模型以
`{ reply, command }` 信封响应：`reply` 是面向作者的正常交流，可回答当前剧情、讨论设计或请求补充信息；
`command` 可以为 `null`，仅在信息充分且确实需要修改时携带 Blueprint Command。命令仍必须经过既有的
Dry Run、Diff 与手动 Apply。

会话以 Workspace Root + Story ID 隔离，保存在 Electron 用户数据目录，不进入 `.story`、`.storyproject`、
恢复快照或编译产物。编辑器保存面向作者的消息，以及供模型继续理解已提议命令的原始响应信封；Provider
reasoning 不持久化。面板支持历史会话切换、New Chat 和带确认的删除。单会话限制 50 条 / 2 MB，总存储限制
32 MB，超过上限时按最近更新时间保留，避免长期使用导致用户数据无限增长。

Provider 的 Endpoint、Model、超时和结构化输出模式保存在编辑器用户数据中，API Key 只经 Electron 主进程访问，
使用操作系统安全存储加密，绝不进入 Renderer、Story 或 Project 文件。远程 Endpoint 强制 HTTPS；仅
localhost、127.0.0.1 与本机 IPv6 回环地址可使用 HTTP，便于连接本地模型。兼容性不足的服务可由 JSON Schema
模式切换到 JSON Object 模式，但返回结果始终经过相同的命令 Schema、Revision、引用、Compiler 和 Dry Run
校验。Apply 只对与当前 Revision 完全相同的 Dry Run 开放；Story 在此期间发生任何语义修改都会使确认失效。

Provider 可选择 Auto、Enabled 或 Disabled 思考模式，并在显式启用时选择推理强度。Auto 不发送厂商专用参数，
保持 OpenAI-compatible 服务之间的默认兼容性。若响应包含 `reasoning_content`（或兼容的 `reasoning`），编辑器
在默认折叠的 Model Reasoning 区域中展示并允许复制；它只存在于当前 Renderer 会话，不写入 Story、Project、
恢复快照或编译产物。Reasoning 仅供作者参考，命令 Schema、Compiler、Dry Run 与语义 Diff 仍是正确性的判据。

剧情内容编辑不要求 AI 整体替换节点 `data`：协议提供 Variable、Dialogue Line、Choice Option 和 Expression
专用命令。Line / Option 命令使用稳定子项 ID 完成插入、局部修改、删除和排序定位；删除 Option 同步清理其
动态输出连线。Expression 命令接收与 Inspector 相同的纯文本表达式，并覆盖 Branch、Set Variable、Choice
可见/可用条件、Event Argument 和 Signal Match。变量定义与当前 Graph 一起进入同一个历史快照，使一次
“创建变量并接入分支”的 AI 事务能够整体 Undo / Redo。

Dry Run 的语义 Diff 使用绿色、黄色和红色区分新增、修改与删除，节点条目包含类型、名称、台词或 Prompt
摘要，以及发生变化的稳定子项和字段路径。通过 Dry Run 后，编辑器建立独立于真实 Graph 的 AI Proposal
Graph：新增节点先按连接关系横向布局，在画布上以绿色虚线高亮并允许作者调整位置；已有节点和连线编辑暂时
锁定。移动预览节点不修改 Story、不标记 dirty、也不进入 Undo。Apply 将命令和调整后的整数坐标作为一个
Undo 检查点原子提交，Discard 则删除整份暂存图。任何作者已有节点都不会被自动布局移动。

Command v1 同时导出 Draft 2020-12 JSON Schema、内置节点 Data/Port Catalog 和随当前 Revision 更新的完整
事务示例。AI Context 必须包含这三部分，并明确顶层字段为 `operations`、Graph 是对象、Port 由编辑器推导。
`baseRevision` 是必填字段。Runtime Validator 不静默归一化模型猜测的格式，会在一次校验中尽可能报告所有
顶层和 Operation 形状错误，包括未知字段；面板的 Copy Retry Context 将诊断、原响应、最新 Schema、节点
目录和 Snapshot 一并交回模型重写。

项目模式下，角色与资产可以位于独立资源文件，Event 与 Signal 位于 Project Registry；它们不会重复嵌入
`.story`。AI Semantic Snapshot、Semantic Revision、Dry Run 返回快照和提交前 Compiler 必须使用项目解析后
的统一资源视图，否则合法的 `speakerId`、`voiceId` 或接口 ID 会被误判缺失。该解析视图只参与上下文和校验，
命令结果仍保存原 Story 自己拥有的数据，禁止把共享资源静默复制进 Story Source。

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

### 14.5 Story 协作合并

Story Merge 第一阶段接受两个可独立解析的同 ID `.story` 文件，以稳定 Chapter、Node、Line、Option
和 Variable ID 对齐内容。Diff 下钻到实际字段，节点坐标、Dialogue 文本、Speaker、Choice 条件、
新增或删除节点与连线分别选择 Local / Remote；默认保留 Local，也可批量选择。Line、Option、Variable
等有序集合同时保留语义顺序，不能因为按 ID 合并而把远端新增项错误追加到末尾。

Apply 前必须使用当前项目解析出的共享资源重新编译完整 Story；验证失败不得修改当前文档。比较期间若
Local Revision 改变，原选择立即失效并要求重新比较。普通双文件比较和 Git 冲突合并都通过
`Apply & Save` 写回当前 `.story`，同时建立单个跨 Graph Undo 快照。

Git 冲突模式直接读取 Index 的 Stage 1 / 2 / 3 作为 Base / Local / Remote，不解析工作树里的冲突标记。
冲突 Story 打开时显示 Local 版本并在状态栏提示；在解决前，普通 Save 和 Save All 都不能覆盖冲突文件。
三方合并自动接受只有一侧修改的字段和非重叠的稳定 ID 项，只把双方对同一语义字段的不同修改交给作者
选择 Local / Remote。写回前仍执行完整编译校验；写回后不自动执行 `git add`，是否 Stage 由作者决定。
当 Local 与 Remote 都在同一条 Base 执行边上各插入一个节点或一段简单线性节点链时，这不是普通的后继二选一冲突。
编辑器将其识别为并发插入组，提供 `Local → Remote`、`Remote → Local`、只保留 Local、只保留 Remote
四种语义决策。排序决策会重建一条合法执行链；只保留一侧会同时移除另一侧整段节点及其相关连线。
只有每个新增节点都恰好具有一个执行入口和一个执行出口、且整段最终回到原 Base 目标时才采用这种处理；
带分支、循环或中途接入其他既有节点的结构继续作为普通图冲突处理，不能强行线性化。
决策尚未作出时，Graph Preview 临时展示两条完整的竞争路径，使双方新增节点都有明确入口和出口；该
双后继状态只存在于只读冲突预览，不能通过校验或写入 Story。

无法满足简单线性链约束的执行结构不能继续拆成互相独立的“单条连线二选一”。编辑器将 Base、Local、
Remote 中发生增删的执行连线构成无向变化图，并按连通分量生成 Execution Region 冲突。同一 Choice / Branch
的多个竞争输出、循环、节点删除以及包含 Rerouter 的局部改线因此只产生一个结构决策。作者选择
`Keep Local Region` 或 `Keep Remote Region` 后，编辑器以所选分支完整替换该区域的执行拓扑，同时移除另一
分支独有且不再存在的节点及所有悬空连线。未作选择时只读预览保留双方结构，不允许 Validate 或 Apply。

Execution Region 只接管节点存在性和执行连线拓扑；双方对共同节点的 Dialogue 文本、名称、参数、坐标等
内容修改仍按稳定字段独立合并。这样选择 Remote 结构不会顺带覆盖作者已经选择的 Local 对白，也避免把
图结构强行当作线性文本块整体替换。

区域决策与字段冲突之间存在显式依赖。若区域选择已经决定一个 Modify/Delete 节点是否存在，该节点的根级
存在性冲突视为 `resolved-by-region`；若所选区域不存在某节点，该节点下的从属字段冲突也不再参与未解决
数量、Previous / Next、批量选择、Validate 或 Apply 门禁。共同保留节点上的字段冲突不会被覆盖。覆盖关系
根据当前区域选择动态计算，不伪造字段决策；改变区域选择后，仍然相关且未单独处理的字段冲突会重新出现。

Execution Region 将节点分为 Core 与 Boundary。Core 包含发生竞争输出的源节点和三方存在性不同的节点；
Boundary 是三方都存在、仅用于连接变化区域与稳定图的节点。连通分量遍历抵达非竞争的稳定 Boundary 后停止，
因此两个只在共同 End 等稳定节点相遇的冲突不会被粘成一个大区域；同一 Choice / Branch 的多个竞争输出
仍因共享 Core 源节点保持为一组。区域替换只处理 Core 关联的执行边，不覆盖 Boundary 的其他稳定分支。
图预览以强实线表示 Core 冲突，以较弱虚线表示 Boundary。

每个区域显示 Core / Boundary 节点名称、竞争输出数量，以及相对 Base 的节点和执行边增删统计。满足任一
条件即标记为 Large Region：Core 超过 12 个节点、竞争输出超过 4 个，或任一侧区域执行边超过 20 条。
Large Region 不参与 `Resolve Remaining Local / Remote`，从画布或列表选择后也只会进入待确认状态；作者
必须查看影响摘要并执行第二次明确确认，才能写入 Merge Decision。

当区域含两个以上竞争输出，且 Base 中所有受影响节点在 Local 与 Remote 都仍存在时，可展开 Per-output
高级模式。每个输出用“源节点稳定 ID + Port ID”生成独立决策键，并分别选择 Local 或 Remote 后继；所有
输出都作出选择前，整个区域仍是 Unresolved。整区 Local / Remote 和逐输出模式互斥，切换模式会清除另一
模式的决策，作者也可显式清空区域选择。节点删除或恢复会改变节点存在性，无法安全拆成输出决策，因此此类
区域只提供整区选择。

逐输出合并先移除各竞争输出的所有候选执行边，再加入每个输出所选一侧的边。随后从非分支独占节点出发做
执行可达性扫描，删除不可达的 Local/Remote 独占新增节点及其所有关联边；该规则也能清理未采用分支内部的
闭环，而不会误删 Base 节点。混合结果实时进入 Graph Preview；所有冲突解决后还必须先通过正式 Story
结构与 Compiler 预检，单后继、入口和引用等约束合法后才可 Validate & Review。

同一 Data Input 被双方改接到不同来源时，必须生成 Connection Competition 冲突，并提供两个来源的
明确选择，不能等到 Validate 阶段只报告双输入错误。双方同时替换同一 Graph 的 Start 时生成 Entry
冲突；选择一侧会移除另一侧 Start 及其相关连线。最终预检要求 Main Story 和每个 Substory 最多只有
一个 Start，缺少 Start 继续由 Compiler 报错。

Line、Option、Parameter、Chapter、Variable 等有序集合若双方在同一 Base 间隙插入不同稳定 ID 项，必须
生成顺序冲突。两侧新增项都会保留，作者选择 `Local Additions First` 或 `Remote Additions First`；只有
单侧插入时继续自动合并，不制造无意义冲突。
项目资源模式读取工作区内 `.storyproject`、`.character` 和 `.asset` 的完整三方版本。Character、Asset
以及项目文件中的 Event / Signal 均按稳定 ID、参数名称和实际字段合并；只有单侧发生的修改自动接受。
Apply 前校验项目索引与独立资源的一致性、Character Portrait 引用，并用合并后的完整项目资源重新编译
所有已登记 Story。全部验证通过后才写回所有涉及的文件；中途写入或删除失败会恢复已修改文件。工作树
写回后仍不自动执行 `git add`。

三方输入允许 Stage 缺失：没有 Base 且 Local / Remote 都存在表示 Add/Add；Base 存在但其中一侧缺失表示
Modify/Delete。相同稳定 ID 的 Add/Add 继续按字段合并，不同稳定 ID 的同路径新增作为整文件冲突处理；
Modify/Delete 在界面中明确显示 `Keep / Delete` 含义。删除资源前仍执行项目索引、引用和全 Story 编译
校验；删除当前 `.storyproject` 时保留工作目录内未选择删除的普通资源文件。

Story 合并选择会同步生成只读 Graph Preview，不提前修改编辑器模型。预览图以合并结果为主体，同时把
Local 或 Remote 中被最终方案舍弃的节点和连线作为幽灵元素补回：新增为绿色、修改为黄色、删除为红色虚线半透明、真实
冲突为橙红色。Main Story、双方已有的 Substory 以及远端新增 Substory 分别生成预览图；新增 Substory
只存在于预览会话，不提前写入本地章节状态。冲突列表可根据稳定 Node ID 切换 Graph 并聚焦，预览顶部
也可直接选择包括 Remote-only 在内的 Graph。

黄色 Modified 只表示节点名称、类型或数据等语义内容变化。自动布局或手动合并造成的纯坐标变化仍会
进入最终 Layout，但不标黄，也不计入最终审查中的 Changed Nodes 数量。

并发插入冲突的高亮目标是 Local / Remote 各自新增的节点及两条竞争入口连线，而不是共同前驱节点；
共同前驱只提供冲突发生的输出 Pin，本身内容并没有冲突。
作出决策后，仍参与最终结果的并发插入节点使用蓝色 Selected 审查高亮：顺序合并时 A/B 都为蓝色，
只保留一侧时保留节点为蓝色、舍弃节点为红色幽灵。Apply 完成后清除全部审查高亮。

点击冲突节点或连线会打开画布内冲突卡片，逐字段显示 Local / Remote 并直接修改同一份 Merge Decision；
Story Merge 列表与画布选择双向同步。字段作出明确选择后仍可回看，但不再计为未解决冲突，节点从冲突色
降级为普通修改色。Previous / Next Conflict 按 Graph 和稳定元素定位遍历尚未解决的节点及连线冲突。
预览期间禁止节点拖动、连接、布局、删除、粘贴和资源拖入，退出预览后恢复普通编辑。

合并选择不存在隐式默认值：未点击的字段保持 Unresolved，不能因为 UI 默认展示 Local 而被视为作者决定。
Story 和项目资源都必须依次满足“未解决冲突为 0、Validate & Review 通过、当前审查 Key 未变化”才能 Apply。
批量操作只填充尚未解决的字段，不覆盖已逐项作出的选择。最终审查汇总 Local / Remote 决策、自动合并
组、节点与连线新增/修改/删除，以及项目资源写入/删除数量。

Story 预检使用完整项目 Character、Asset、Event、Signal 编译合并结果但不写盘；项目资源预检复用正式
Apply 的项目索引、Portrait 引用和全 Story 编译校验，但在写入阶段前返回。每个 Git 冲突的 Base / Local /
Remote Stage 内容生成 SHA-256 Revision；Validate 和 Apply 都重新读取并比较 Revision，Story 最终写文件前
主进程再次原子检查。任何选择、Story Revision 或 Git Stage 变化都会使旧验证结果失效并要求重新审查。

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
