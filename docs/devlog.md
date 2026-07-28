# Dev Log

> 人机共读开发日志。新机器 clone 后看这里就能接上。

---

## How to run

```bash
npm install
npm run dev
```

`packages/editor/scripts/dev.cjs` 会自动清除 `ELECTRON_RUN_AS_NODE` 和 `NODE_OPTIONS`（WorkBuddy/Electron 父进程继承的脏环境变量）。

如果 wrapper 不生效，手动：`unset ELECTRON_RUN_AS_NODE && unset NODE_OPTIONS && npm run dev`

---

## Current: Workspace Explorer / Runtime Preview

- Dialogue 支持可排序的多 Line 连续对话段；每句独立拥有稳定 Line ID / Text ID、Speaker、Emotion、Voice 和 Tags，节点不保存对话默认值。
- Dialogue Inspector 增加本地打包的 Monaco `Lines / Ink` 双视图；结构化 Line 与 Dialogue Ink 子集双向同步，错误草稿不写回节点。
- Dialogue Line 卡片默认折叠为说话人与台词摘要，可一键展开完整属性或跳转并选中对应 Ink 行；画布预览限制为前三句、每句两行。
- Monaco Ink 编辑器支持持久化字号缩放、`Ctrl++ / Ctrl+- / Ctrl+0` 与大高度编辑区。
- Dialogue Ink 说话人改用 `Character: text` 剧本前缀，明确拒绝早期行尾 `# speaker` 试验格式。
- `.story` 升级为不兼容 v3：Dialogue 删除所有节点级默认字段，Speaker / Emotion / Voice 完全归属各 Line，不提供迁移。
- Monaco 内 `Ctrl+S / Ctrl+Shift+S` 会先校验并原子写回当前 Ink Lines，再保存 Story；错误草稿不会覆盖磁盘。
- Renderer CSP 为 Monaco 错误装饰开放 `img-src 'self' data:`，修复内嵌 SVG 波浪线被拦截，同时不放宽脚本策略。
- Ink 视图改为离开时自动写回 Lines 并保存 Story，移除 Apply 按钮；存在诊断时阻止切回 Lines。
- Ink 自动应用使用进入编辑器时的蓝图快照建立单一 Undo 事务，离开 Monaco 后可完整撤销 Dialogue 修改。
- Choice Option 对齐 Dialogue Line 的折叠卡片、排序和增删操作，并支持 Monaco 编辑 Prompt、`* Option` 及条件标签；离开自动保存可整体撤销，删除 Option 会同步清理其输出连线。
- 项目文件新增 Event Definition Registry；Story Data 可编辑稳定 Event ID、名称、Description 与 Boolean / Number / String 参数，并可拖到画布创建 Call Event。
- Call Event 简化为单向派发并立即继续，不再暴露完成、返回值或失败分支；Preview 自动记录派发。
- Signal 支持 Boolean / Number / String 参数 Schema 和 Payload；Wait 节点可逐项选择 Any 或 Match Expression，Runtime 消费第一条匹配项，未匹配及提前到达的完整 Payload 队列参与存档恢复。
- Runtime Preview 新增本地单槽 Save / Load 与 Copy State；加载通过 JSON 状态创建全新 Runtime，并恢复 Pending Dialogue / Choice / Signal、Call Stack、变量和 Signal Inbox。Preview Content Version 改为当前编译输入指纹，拒绝加载已变化蓝图的旧状态。
- AI Editing Foundation 第一版完成：输出无坐标 Semantic Snapshot 与确定性 Revision；版本化 Blueprint Command 支持节点增删改、连接与断开；不可信 JSON、端口、类型、Source Schema 和 Compiler 分层校验，支持 Dry Run、Revision 冲突、整笔回滚和活动 Graph 单次 Undo。跨 Graph 提交暂时明确拒绝，等待整 Story 历史快照。
- Call Event 的 String 参数默认使用无引号 Text 模式并自动编码字符串字面量；需要变量或组合逻辑时可显式切换为 Expression 模式。
- Project Events 升级为可搜索的接口表，展示脚本签名与 Description；说明随 `.storyproject` 往返并进入 node-free 编译项目清单，供引擎程序实现 Handler。
- Project Events / Signals 提供统一的人类可读 Project Interface Table，可横向查看完整接口并一键复制 Markdown 交付程序员；点击表格行可返回具体定义编辑。
- Side Effect 暂无 Runtime 行为且分类含糊，先从 Event 编辑器和人类接口表隐藏；底层字段仅作为内部默认值保留，未来按 Pure / Query / Command 的实际需求重新设计。
- Inspector 支持新增、复制、删除、上下移动和拖动排序 Line；画布紧凑预览前三句和总数，整节点复制时重新生成全部 Line / Text ID。
- `.story` KDL 使用紧凑 `line <lineId> <textId> <text>` 结构，仍可读取旧单 `text` Dialogue；Compiler 生成逐句暂停的连续 Dialogue 指令。
- Pin 的透明拉线热区使用十字准星；普通节点使用四向移动光标。Reroute 按 UE Knot 语义划分为四向箭头外圈移动区，以及十字准星内圈输入/输出拉线区。
- 新增 Reroute 与同图 Flow Portal：双击 Wire 插入横向自适应的 Knot 式 Reroute，右键 Wire 可转换为 Jump / Anchor；选中端点时显示虚拟跳转线，双击 Jump 可定位 Anchor。
- `.story` KDL 持久化 Portal 的稳定同图引用；复制粘贴会重映射成对端点，删除 Anchor 会安全清空存活 Jump，提取 Substory 暂时拒绝跨边界 Portal。
- Compiler 折叠 Reroute，并将 Jump → Anchor → 后继降级为普通 Runtime Jump；项目诊断将虚拟 Portal 计入可达性和循环分析，运行产物不包含视觉路由节点。
- Alt+左键点击 Wire 可直接断开单条连线；Alt+点击 Pin 仍断开该 Pin 的全部连线。
- 新增 UE 风格 Pin 操作：Alt+左键点击断开该 Pin 全部连线，Ctrl+左键拖到同方向兼容 Pin 整体转移连线；拖动期间显示连线预览，并在画布左上提供 Shortcuts 说明。
- 普通执行输出重新连接到新节点时自动替换旧连线，不再显示“只能连接一个后继”；其他端口方向、类型和占用错误仍照常诊断。
- Story Graph 左上可选择并持久化 Blueprint / Standard 操作模式；前者左键框选、右键平移，后者左键平移、Shift+左键框选。
- Set Variable 写入 String 时提供 Text / Expression 模式；Text 直接填写普通文本并自动安全编码，不再要求作者手写表达式引号。
- 编辑器主要错误入口支持直接复制：Problems 可复制全部结构化诊断，运行预览、工作区、画布临时错误和状态栏错误提供就近 Copy，正文仍可鼠标选择。
- 项目角色和资产已拆分为 `Characters/*.character` 与 `Assets/*.asset`；`.storyproject` 保存资源路径和跨 Story 使用索引。
- Story Data 在项目模式下直接管理共享资源，支持搜索、角色默认/情绪肖像选择，以及资产按 Locale 配置资源路径。
- 共享资源修改会排队即时保存；Save All 和切换项目等待写入完成，删除前检查所有 Story 引用、未保存状态和角色肖像依赖。
- 工作区同步与 Compiler 会诊断重复资源、悬空 Speaker/Voice/Portrait 引用和错误资产类型；构建时仅合并各 Story 实际使用的项目资源。
- Explorer 与 Story Data 支持定位项目、Story、角色和资产文件；删除与关闭 Story 明确分离，删除项目文件不会连带删除项目内容。
- 通过欢迎页或现有工作区新建项目时，会自动创建、设为入口并打开默认 Main Story。
- Story Data 保留左侧列表，变量、角色和资产表单移入右侧 Inspector；角色 Name 会同步 Display Name，但 `.character` 创建后的文件路径保持稳定。
- 项目资源删除从“任意 Story dirty 即禁止”改为真实引用检查：保存内容查项目索引，未保存内容查已打开内存图。
- 角色删除改为主进程统一的原生 Delete / Cancel 确认，取消后保留角色文件和当前 Inspector 状态。
- 变量、角色和资产 Name 改为草稿提交；编辑时允许清空，空值失焦、Enter 或 Esc 会恢复原名。
- 变量 Name 与角色一致：确认重命名后同步更新 Display Name，并继续安全改写表达式和模板引用。
- 修复项目角色引用导致 `.story` 保存和恢复快照崩溃：KDL 保留外部资源 ID，完整存在性检查移至项目同步与 Compiler。
- 启动流程改为空会话欢迎页，不再自动打开 Untitled Story；支持原生 New/Open/Save Project 和 Open Story。
- 关闭 Story、退出软件或切换项目时统一提供 Save / Don't Save / Cancel；保存会覆盖所有已修改的 Story 标签。
- 成功切换项目后会清空旧项目的标签和编辑状态，避免跨项目资源混用。
- 欢迎页会持久显示最近打开的项目，支持一键重新打开或从列表移除。
- 新建/打开项目、工作目录和 Story 的原生文件窗口默认从系统“文档”目录开始。
- File 菜单和 Open Stories 工具栏新增 Save All，可依次保存所有脏 Story，并在取消任一保存时保留已完成结果。
- 编辑器会持久记录工作目录、已打开 Story 和活动 Story；重启后恢复同一工作会话，缺失文件会安全跳过。
- 脏 Story 会延迟写入用户数据目录中的恢复快照，不直接覆盖源文件；异常退出后的下次启动可选择恢复或丢弃。
- Project Compiler 可构建整个 `.storyproject` 并导出版本化、无节点信息的 `.storyc.json` 项目包；内容版本由源数据稳定计算。
- Problems Dock 面板汇总跨 Story 编译错误与警告，点击可打开对应 Story、切换 Substory、选中并聚焦源节点。
- 项目设置可选择默认入口 Story 和工作区内的编译输出目录；未配置目录时使用原生导出窗口。
- Runtime 新增 `.storyc.json` 解析和入口执行 API，Runtime Preview 可直接打开编译产物验证实际运行行为。
- 关闭最后一个 Story 后回到欢迎页，Story Data、Inspector 与 Runtime Preview 显示相应空状态。
- 工作区可创建版本化 `.storyproject`，同步 Story 相对路径、角色、资产及跨 Story 使用关系。
- 项目索引具有路径逃逸、重复 ID、悬空资源使用与跨 Story 定义冲突校验。
- Resource Browser 现分为 Open Stories 与 Explorer；可选择真实工作目录、浏览嵌套文件夹，并从目录树按需加载 `.story`。
- 支持在选中目录中新建文件夹和 Story，刷新磁盘树；文件 IPC 会阻止相对路径或符号链接逃逸工作区。
- Resource Browser 采用 Story → Main Story / Substory 层级，可同时新建、打开、切换、重命名和关闭多个 Story。
- 每个 Story 独立保留图、变量、角色、资源、文件路径和 dirty 状态；文件授权也支持分别保存多个已打开 Story。
- Resource Browser 已支持 Main Story 与多个 Substory 的创建、重命名、切换和引用安全删除。
- 画布多选节点可提取为单入口、单出口 Substory；原位置自动替换为 Call Substory，子故事自动生成 Entry 与 Return。
- `.story` KDL、Compiler 与 Runtime 已贯通 Substory Graph、Call Chapter、Call Stack 和 Return。

- Runtime Preview 已接入 Dockview，可直接编译并运行当前 Story，支持逐句继续、选项、历史、变量和执行位置查看。
- Runtime 新增 `blockId + instructionIndex` 状态机；Dialogue / Choice 形成稳定暂停点，Branch / Set Variable / Jump 自动执行，End Story 正常终止。
- Runtime 对非法位置、非法选项、表达式错误、未支持指令和无等待点紧密循环返回结构化诊断。

### M1 Done

- Electron + React 项目骨架（npm workspaces + electron-vite + TypeScript）
- 主窗口布局：Dockview 三栏 + 底部 Console；支持拖拽、分组、浮动、恢复关闭面板和持久化布局
- MenuBar / StatusBar
- StoryGraph 画布接入 React Flow（无限画布、背景网格、MiniMap、Controls）

### M2 Done (Node System)

- `packages/common/src/types/nodes.ts` — StoryNodeType 枚举 + 5 种节点数据接口 + NodeDefinition
- `packages/common/src/registry/nodeRegistry.ts` — 注册表：register / get / has / list / listByCategory + 5 种内置类型
- `packages/common/src/registry/nodeFactory.ts` — 工厂：create(id, type, position) + generateId
- `packages/editor/.../Nodes/` — 5 种自定义 React Flow 节点组件（Start / Dialogue / Choice / Branch / End）
- StoryGraph 已接入 nodeRegistry + nodeTypes 映射，使用工厂生成演示节点
- `npm run build` 全套构建通过

### Story Data + Compiler foundation done

- 左下 Story Data 面板管理 Story / Chapter / Local 变量、角色和基础资源定义，支持 Dockview 停靠和浮动。
- 变量、角色可拖到画布创建 Get / Set Variable 或 Dialogue；也可拖入 Inspector 的模板、表达式和 Speaker 字段。
- Dialogue / Choice 使用 `{expression}` Text Template；Choice 区分 Visible If 与 Enabled If；Branch / Set 使用安全表达式。
- `.story` 切换到不兼容 v1 的紧凑 v2：短 ID、整数坐标、可选节点名、无持久化 Edge ID、默认端口和版本省略。
- 默认 Compiler 将节点图降级为无坐标、无编辑器节点 ID 的 Runtime Program；Runtime 提供表达式求值、模板渲染和选项过滤。

### Next

**[M7/M8] Compiler + Runtime Preview**

- 实现 Dialogue / Choice / Branch / End 的最小执行器
- 编辑器内运行当前 Story
- 见 `docs/task.md` → Milestone 7 / 8

---

## Recent changes

| Date       | What                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------ |
| 2026-07-27 | Dialogue Inspector 接入离线 Monaco Ink 编辑视图，支持行级元数据、诊断、稳定 ID 对齐、原生剪贴板及 Lines 双向同步   |
| 2026-07-25 | 增加左下 Story Data、变量/角色编辑、拖拽创建 Get/Set/Dialogue，以及 Inspector 模板和表达式变量投放                 |
| 2026-07-25 | `.story` 改为紧凑 v2：短稳定 ID、整数坐标、可选节点名、无 Edge ID；不兼容且不迁移旧格式                            |
| 2026-07-25 | Compiler 实现安全表达式、Text Template 与基础图降级；Runtime 实现求值、模板渲染及 Choice 显示/可用条件             |
| 2026-07-25 | 用 Dockview 替换自制浮窗与固定分栏：面板可拖拽分组、应用内浮动、显式 Float / Dock，并持久化布局                    |
| 2026-07-25 | View 菜单可重新打开四个面板或重置布局；Inspector 默认 420px、最小 360px，浮动宽度 520px                            |
| 2026-07-25 | 收紧 Electron preload / IPC 与文件能力边界；异步保存按文档 revision 清理 dirty，避免覆盖保存期间的新编辑           |
| 2026-07-25 | Electron 从已停止维护的 31 升级到 43.2.0；Node 最低版本同步提升为 22.12，并完成真实启动验证                        |
| 2026-07-25 | common/compiler/runtime/sdk 改为 tsup 双格式包入口，覆盖 ESM/CJS/types，并建立统一 Node 版本基线                   |
| 2026-07-25 | KDL parser/writer 增加结构、未知字段与重复 ID 校验；新增 Vitest 测试与 GitHub Actions 全量 CI                      |
| 2026-07-25 | 修复 React Strict Mode 导致浮窗创建后立即关闭；Inspector 改为 420px 默认、360px 最小的固定像素约束                 |
| 2026-07-25 | 补齐面板标题栏拖拽拆分；扩大左右调宽手柄命中区，并修复 Console 上下调高分隔条尺寸                                  |
| 2026-07-25 | Inspector 默认宽度提升到 28%；Resource Browser、Inspector、Console 支持拆分为原生浮动窗口并在关闭后自动回停靠区    |
| 2026-07-25 | 使用 `@bgotink/kdl` 实现当前基础节点的 `.story` Parse / Serialize 与稳定格式化，往返烟雾测试通过                   |
| 2026-07-25 | 完成 New / Open / Save / Save As 文件菜单、快捷键与 Electron IPC；未保存修改在关闭、New、Open 前受到保护           |
| 2026-07-25 | 重建原先不完整的 package-lock，并将根与 editor 的 Electron 统一固定为 31.0.0                                       |
| 2026-07-25 | 图状态提升到 StoryGraph Store，StoryGraph 与 Inspector 共享同一个 EditorGraphState                                 |
| 2026-07-25 | 完成右键节点创建菜单；Story Entry 保持单实例，创建操作进入 Undo / Redo                                             |
| 2026-07-25 | Inspector 支持节点名称、Dialogue、Choice、Branch、Start、End 属性双向编辑，编辑事务可撤销                          |
| 2026-07-25 | 完成单选、多选、框选、删除、Copy / Paste / Duplicate，以及节点移动和图编辑的 Undo / Redo                           |
| 2026-07-25 | 建立 EditorGraphState → SourceGraph 转换；复制子图会重建 Node、Choice Option、Edge ID 并保持内部连接               |
| 2026-07-25 | 完成 Typed Graph 端口解析与连线校验：方向、执行/数据类型、动态端口、重复连接和连接占用规则                         |
| 2026-07-25 | React Flow 接入统一校验，非法连线显示错误提示，Edge 使用稳定 ID                                                    |
| 2026-07-25 | 建立 Source Model、稳定 ID、表达式、Runtime Program/State、Adapter 类型契约与 Runtime 控制流校验                   |
| 2026-07-25 | 节点持久化类型统一为 `story-entry/end-story`，静态端口由 Node Definition 派生，Choice 输出声明为动态端口           |
| 2026-07-25 | 补齐 common → compiler/runtime/sdk 的 TypeScript project references                                                |
| 2026-07-23 | 修复 tsc 泄漏产物导致节点消失：清理 src 中 .d.ts/.d.ts.map/.js/.js.map，registerBuiltins 从 useEffect 提到模块顶层 |
| 2026-07-23 | 修复 tsc 在 src/renderer 中生成 .js 文件导致 Vite esbuild JSX 解析错误                                             |
| 2026-07-23 | M2 节点系统：NodeRegistry + NodeFactory + 5 种自定义节点组件                                                       |
| 2026-07-23 | M1 StoryGraph 画布：React Flow 集成、背景网格、MiniMap、测试节点                                                   |
| 2026-07-23 | 从 pnpm 切换到 npm（pnpm 的嵌套 node_modules 导致 Electron 模块遮蔽问题）                                          |
| 2026-07-23 | M1 布局框架完成，Electron 可在外部终端正常启动                                                                     |
| 2026-07-23 | M0 项目初始化完成：workspace、TS、ESLint、Prettier、Electron + React 骨架                                          |
