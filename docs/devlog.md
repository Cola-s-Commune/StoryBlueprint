# Dev Log

- 新增项目级《编辑器撤销与重做规范》：所有内容新增、删除与修改默认必须可原子恢复；统一定义事务边界、文本草稿、跨文件写回、快捷键、例外和新功能验收清单，并登记全项目资源操作审计任务。
- 撤销规范首轮审计将 Project Variable、Event 与 Signal 纳入统一 Editor History；新增、删除、属性及参数改写可 Undo / Redo，事务同时快照受影响的已打开 Story，并按顺序写回 `.storyproject`。Event / Signal 删除不再错误提示“不可撤销”。
- Character / Asset 的外部资源新增和删除接入资源快照历史：Undo / Redo 保留稳定 ID、内容与原相对路径，由主进程校验引用后原子调和文件并同步项目索引，失败时回滚本轮文件变化；快速连续撤销也严格服从项目写入队列。
- Story / Substory 撤销审计完成：新增或删除 `.story` 会保留原路径、完整文本、项目索引和编辑器标签状态，历史回放按队列恢复/移除文件并在同步失败时回滚；Substory 新增、删除、重命名与选区提取均保留跨 Graph 原子历史，不再清空 Undo。
- 统一 History 增加操作名称、canUndo / canRedo 与 Redo 分支状态；Edit 菜单会显示具体的 Undo / Redo 目标并在空历史时禁用，主要 Story、Substory、节点、变量、角色、资产、Event、Signal 与 AI/Merge 事务均登记可读名称。
- 新增可停靠 Operation History 面板：按时间线展示可撤销、当前与可重做状态，可直接跳到任意历史位置；多步跳转复用原子快照与资源写回队列，仍可沿反方向恢复。
- Character 资源状态加入统一 Editor History；添加/删除 Field、Emotion、Relationship，以及 Tags / Metadata / 文本提交均形成一次 Undo 步骤。Ctrl+Z / Ctrl+Y 恢复项目角色后会按队列写回 `.character`，Emotion 重命名/删除与 Dialogue 引用改写共享同一原子历史点。
- 修复 Character Inspector 中文本框看似可聚焦却无法稳定编辑：表单键鼠事件不再冒泡给画布与 Dock，Display Name、Metadata、Field 默认值和 Emotion 名称改为本地草稿，失焦/Enter 后一次提交，避免逐键写磁盘及异步 Workspace 回写打断输入。
- Character Template 使用独立 `.character-template` KDL 资源保存在项目 `Templates` 目录；可从角色保存并从 Blank / 内置 / 项目模板新建。模板保留 Fields、Emotions、Tags、Metadata 与 Dialogue Style，但剥离角色身份、关系和 Portrait，实例化时重建全部稳定 ID；AI Semantic Snapshot 暴露可用模板并支持 `add-character-from-template` Command。
- Character 列表加入标签筛选、多选与批量 Add/Remove Tag；列表展示头像状态、标签和已加载 Story 引用数，并可一键复制角色。复制会为角色及其 Character Fields 生成全新稳定 ID，避免运行时状态身份冲突。
- Character 新增可搜索 Tags 与项目自定义 Metadata（String / Number / Boolean）；独立资源和内嵌 Story KDL 均稳定排序持久化，编辑器可增删改并自动去重标签，AI Add / Update Character Schema 同步支持。
- 外部文件监听与编辑器重载规则拆为可测试的纯决策模块；新增内容指纹 Diff、自保存过滤、干净/脏 Story、资源删除、快速连续写入与 Git checkout 可控时钟抑制测试，避免轮询测试依赖真实等待。
- 外部文件变更保护使用内容指纹轮询覆盖 Story / Project / Character / Asset：无本地修改时自动重载，重叠修改进入审查卡片；Story 支持以上次磁盘内容为 Base 的三方 Story Merge、另存编辑器版本、载入磁盘或保留编辑器版本，删除/移动会明确提示。Git checkout 期间抑制重复外部变更提示。
- Crash Recovery 从原生二选一提示升级为应用内恢复中心：逐项显示保存时间、原路径与磁盘状态，支持 Recover / Save As / Discard；磁盘已变化时恢复后可 Undo 回磁盘图状态，损坏数据会报告且不覆盖恢复文件。
- Windows 发布加入 Story Blueprint 专属图标、EXE 产品元数据和 NSIS 安装包；安装器可选择目录并创建桌面/开始菜单快捷方式，同时保留 portable。Help → About 显示版本、Electron/Chromium/Node、平台和当前项目位置。
- 主窗口记忆普通位置、尺寸和最大化状态；显示器变更后会把离屏窗口安全居中。应用限制为单实例，重复启动会还原并聚焦已有窗口，标题栏空白区支持双击最大化/还原。
- 主窗口改用应用内统一标题栏：移除 Electron / Windows 原生菜单和空的 Console 占位面板，右侧加入自绘最小化、最大化/还原、关闭按钮；关闭仍经过未保存 Story 保护。
- Windows Release Build 接入 electron-builder：工作区 Common / Compiler / Runtime 内联到主进程 bundle，ASAR 仅包含生产 `.output`，支持 `win-unpacked` 与单文件 portable；隐藏启动 smoke test 会验证 EXE、ASAR、preload 与 renderer，发布要求 Node.js 22.12+，代码签名和自动更新尚未配置。
- 大型蓝图性能基线覆盖 1000 节点 / 999 连线的 KDL 往返、编辑器加载/保存、自动布局和项目编译；连接校验改为节点、端口与占用关系索引，图加载、Compiler 和 AI 最终校验不再逐边复制并扫描完整图。画布只渲染可视元素，装饰层保留未变化节点/连线的对象身份，布局队列与 Flow Portal 查找也移除平方级路径。
- Character Field 引用闭环：限定表达式 Binding 写入 `.story` KDL，角色/字段改名跨已加载 Story 安全改写；引用索引覆盖 Get/Set、模板、条件、Event 与 Signal，并保护角色/字段删除和字段改型。AI Command API 新增 Add/Update Character（含 Field）且复用引用保护。
- Character 新增强类型 Field：角色资源保存稳定字段 ID、名称、标量类型与默认值；表达式支持 `CharacterName.fieldName`，Get / Set Variable 可直接选择角色字段，Runtime Driver 通过 Adapter 在启动时读取并在暂停或结束时回写。
- 资源引用性能优化：Character、Emotion 与 Asset 从逐项重复扫描改为相关 Inspector 打开时单次构建共享 Map；查询按 ID 直接读取，列表默认只渲染前 30 项，并新增 1000 个 Dialogue 引用覆盖测试。
- Character、Emotion、Voice 与 Portrait Asset Inspector 接入跨 Story 引用审查：引用项可跳到具体 Graph/Dialogue Line 或 Character 配置，存在引用时 UI 与 Store 双层阻止删除，不再静默清空 Speaker、Voice 或 Portrait。
- Variable Inspector 新增跨 Main Story / Substory 的统一引用列表和节点跳转；存在引用时阻止删除。安全重命名覆盖文本模板、Choice/Branch、Set Variable、Event Argument 与 Signal Match，更新稳定 ID Binding，并避免误改字符串字面量和相似标识符。
- Execution Region 新增 Per-output 高级处理：稳定输出键可分别选择 Local / Remote，未选完保持未解决；混合拓扑重建后以可达性清理未采用的独占分支和闭环，并在正式 Validate 前执行结构预检。涉及 Base 节点删除的区域仍强制整区选择。
- Execution Region 增加过大区域保护：变化节点分为 Core 与稳定 Boundary，遍历在 Boundary 停止以拆开独立冲突；界面显示节点/连线影响，预览用虚线标记边界，超过节点、输出或连线阈值时跳过批量选择并要求二次确认。
- Execution Region 增加冲突依赖消解：区域选择会覆盖已决定存在性的 Modify/Delete 和被删除节点从属冲突；统计、批量处理、画布导航、预览及 Validate/Apply 共用同一有效冲突判断，共同节点字段仍独立处理。
- Story Merge 新增 Execution Region 结构冲突：无法线性化的分支、循环、删除和 Rerouter 改线按连通变化区域合并成一项，可完整保留 Local / Remote 拓扑；结构选择不覆盖共同节点上的对白等字段决策。
- Story Merge 的同边并发插入从单节点扩展为简单线性节点链；四种排序/取舍决策会处理整段路径，预览高亮与局部布局覆盖链上全部节点，并明确拒绝分支、循环和中途接入既有节点的结构。
- 有序集合三方合并检测同一 Base 间隙的双方并发插入；Dialogue Line、Choice Option、Event/Signal Parameter 等不再静默采用 Local-first，而是显式选择双方新增项顺序。
- Story Merge 新增 Data Input 来源竞争与 Start 入口竞争的语义冲突：用户可直接选择 Local / Remote 来源或入口；选择 Start 时同步清理另一入口及其连线，预检拒绝多 Start Graph。
- 并发插入冲突作出决策后增加蓝色 Selected 审查态：顺序合并高亮双方节点，只保留一侧时蓝色标记保留节点、红色幽灵标记舍弃节点，直至 Apply。
- Story Merge 的 Modified 节点高亮与 Changed Nodes 统计忽略纯坐标变化；自动整理后的后继节点不再因位置移动被误标为黄色内容修改。
- Story Merge 会识别同一 Base 执行边上的双分支并发节点插入，直接提供 Local→Remote、Remote→Local、只保留 Local、只保留 Remote 四种决策，并重建合法单后继执行链；未决预览展示并高亮两个插入节点及竞争入口连线，不再误标共同前驱；只保留一侧时仍以红色幽灵展示另一侧被舍弃的节点和连线，排序后自动整理局部链，幽灵节点主动避让保留节点。
- Character Inspector 将 Emotion 从逗号文本升级为 Key / Display Name / Portrait 结构化列表；Emotion Key 重命名会同步已打开 Story 的 Dialogue Line，删除时确认并清除对应引用。
- Dialogue 编译会解析角色立绘：优先使用 Emotion Portrait，缺省时回退 Default Portrait，并将最终 Asset ID 交给 Runtime / Engine Adapter。
- 新建 Story Blueprint 项目会自动生成 `.gitignore`：默认排除编译产物与常见本地杂项，并使用仅新建写入保证不覆盖用户已有规则。
- Resource Browser 显示项目的 Git 仓库与分支状态；未建仓项目可一键初始化 `main`，位于父级仓库中的工作区不会创建嵌套仓库。
- 外部切换 Git 分支或 detached HEAD 后，编辑器自动重扫项目并重载所有已打开 Story；未保存内容会先请求确认，同分支普通提交不会触发重载。
- Git Index 进入或退出未合并状态也会触发安全重载；冲突 Story 使用 Local Stage 保持可解析，并提示通过 Story Merge 处理。
- Story Merge 的 Git Local 一致性检查改用稳定 ID 语义 Diff，避免编辑器重建 Graph 后因对象字段顺序等非语义差异误报内存 Story 已变化。
- 移除 `toSourceGraph` 中未被 KDL 持久化的 Choice `dynamicPorts` 派生字段；Choice Options 已是唯一权威来源，修复含 Choice 的 Git Local 一致性误报。
- Git 冲突阶段允许临时载入违反单后继规则的全部连线，供 Story Merge 展示和取舍；普通文件加载和用户新建连线仍执行单后继校验。
- Story Merge Graph Preview 同样使用宽松冲突图加载，避免 Local Stage 已载入后在自动生成预览时再次触发单后继异常。
- 三方 Story Merge 按执行输出检测竞争后继：Local / Remote 同时把同一 Pin 改接到不同目标时生成显式连接冲突，选择一侧会替换整组候选边，避免自动合并成无效双后继。
- Auto Layout 不再把所有零入度节点强制放到最左列：Start 主链仍从第 0 层开始，其他入口或孤立分量根据已连接目标和布局前最近的空间邻居选择起始层。
- Story Merge 将节点坐标作为 `{x, y}` 整体冲突，并提供批量保留 Local、采用 Remote 及仅移动冲突节点的自动布局操作；无冲突节点会作为固定锚点与避让区域。
- Story Merge 自动检查远端新增节点与本地现有节点的视觉重叠，只重新安置发生碰撞的新增节点；避让使用节点估算宽高，较高的 Dialogue 节点不会再按固定中心距离误判。
- Story Source v4 将 `x/y` 从节点声明移入 Graph 的独立 `layout` 区域，降低移动节点与编辑故事内容之间的 Git 冲突；坐标冲突新增 Local/Remote 顺序优先的局部邻域整理，且不会穿透 Rerouter。
- AI Command v1 新增 `layout-selection` 与 `layout-neighborhood`：通用执行器只验证并返回布局请求，编辑器负责生成可移动、可撤销、需确认 Apply 的布局预览；AI 仍不能提交原始坐标。

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
- 多选连续 Dialogue 节点可合并为一个连续段；Lines 视图可勾选若干 Line，并按原顺序拆成连续 Dialogue 链。两种操作保留 Line / Text ID、重写边界连线且可整体 Undo。
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
- 新增可停靠 AI Commands 面板：可复制模型上下文或纯语义 Snapshot、粘贴 Blueprint Command JSON、强制 Dry Run 并查看节点/连线语义 Diff，再 Apply 为单个可撤销事务；Revision 或命令变化后旧确认自动失效。
- AI Command 扩展 Story Variable、Dialogue Line、Choice Option 与 Expression 专用操作；表达式覆盖 Branch、Set Variable、Choice 条件、Event 参数和 Signal Match，Option 删除会清理动态输出连线。编辑历史同步保存变量表，变量与 Graph 的复合事务可整体 Undo / Redo。
- AI Apply 增加连接感知的横向布局，只移动新建节点；新增/修改节点分别绿色与黄色高亮并自动聚焦，画布提供 Accept / Undo AI Changes。Dry Run Diff 展示节点内容摘要、稳定子项字段路径，并以红色明确标示删除项。
- Blueprint Command v1 导出 Draft 2020-12 JSON Schema、内置节点 Data/Port Catalog 和有效事务示例；`baseRevision` 改为必填。AI Context 明确禁止 `commands`、字符串 Graph 和模型自造 Ports，校验器一次返回多个路径诊断，面板新增 Copy Schema 与 Copy Retry Context。
- 修复 AI Dry Run 将项目级共享角色误判为缺失：Semantic Snapshot、Revision、执行结果和 Editor Compiler 统一使用解析后的角色、资产、Event 与 Signal 资源视图，同时保持 `.story` 不重复保存项目共享资源。
- AI Commands 接入内置 OpenAI-compatible Provider：支持选中节点 / 当前 Graph / 整个 Story 上下文、生成取消、验证诊断重试和生成后自动 Dry Run；API Key 仅由主进程通过操作系统安全存储读写，远程地址强制 HTTPS，本地模型允许回环 HTTP。手动复制 / 粘贴流程继续保留。
- AI Commands 调整为自然语言优先的渐进式界面：Provider 与 Command Details 默认折叠，JSON / Snapshot / 外部 AI 工具仅在需要时展开；空闲时隐藏结果操作，Dry Run 后先展示紧凑变更计数，再按需展开非空 Diff 分类。
- AI Commands 支持 Auto / Enabled / Disabled 思考模式与推理强度；Provider 返回的思考内容以默认折叠、可复制的会话面板展示，不写入 Story、Project 或编译产物。
- AI Commands 升级为会话式 Story Assistant：每轮读取最新语义 Story 状态，可回答剧情问题或追问作者；回复携带可选 Blueprint Command，只有确实提议修改时才进入 Dry Run / Diff / Apply。
- AI 命令适配器会自动把 Line / Option 专用操作中误用的 `{ source: text }` 规范化为纯字符串，同时保持 add-node 的 Source 数据形状不变，避免模型混淆两层文本协议。
- Story Assistant 改为 Codex 风格的 chat-first 工作区：对话占据主体、Composer 固定在底部、Enter 发送、发送后立即展示请求与工作状态，并把 Blueprint 提案、验证和 Apply 作为独立审核卡片。
- Story Assistant 会话按 Workspace + Story 持久化到编辑器本地用户数据，支持历史会话切换、New Chat 与可取消删除；保存可见对话及模型后续所需的命令信封，不保存 reasoning，也不写入项目资源。
- 修复画布组合交互：多选外框支持右键平移，Shift+框选追加节点；AI 变更保持待确认直至 Accept / Undo，不再定时消失；窗口级 Ctrl++ / Ctrl+- / Ctrl+0 与 View 菜单缩放正式生效。
- AI 节点确认改为真正的 Proposal Graph 暂存：Dry Run 后即可在画布移动新增节点，移动不改变 Story；Apply 才把命令与预览坐标作为单个 Undo 事务提交，Discard 无痕取消。
- Graph 左上新增 Layout Selected / Layout All；按执行流从左到右分层，支持循环与独立分支，局部整理不移动选区外节点且可 Undo。AI 预览期间改为 Layout Proposal，只整理新增预览节点而不提前 Apply。
- Auto Layout 改为读取 React Flow 实测节点尺寸：横向按列最大宽度推进，纵向按每个节点实际高度累加，避免多 Line Dialogue 等大节点在整理后互相覆盖。
- Auto Layout 不再把 Reroute 当作剧情层级：计算执行顺序时穿透 Knot，整理后将前向 Knot 放回端点之间，并把循环 / 返回线的 Knot 分配到图下方独立通道。
- Graph 新增 Ctrl+F Story Search：跨 Main Story / Substory 检索节点、逐条 Dialogue、Choice Option 和 Story Data；支持多词过滤、键盘上下选择、Enter 定位，并自动切图、选中和缩放到目标节点。
- 新增可停靠 Story Merge：选择另一个同 ID `.story` 后，按稳定 ID 展示字段级 Local / Remote 语义差异，支持逐项或批量取舍；有序 Line / Option 保持相对位置，Apply 前完整编译验证，并作为单个跨 Graph Undo 修改写入当前 Story。
- Story Merge 支持读取 Git Index 的 Base / Local / Remote 三方版本：非重叠修改自动合并，只展示真正的字段冲突；冲突文件以 Local 安全打开，普通保存受保护，Apply & Save 编译通过后写回但不自动 Stage。
- Story Merge 新增 Project Resource Merge：对 `.storyproject`、`.character`、`.asset` 做多文件三方语义合并，Event / Signal 参数按名称对齐；写回前校验项目索引、Portrait 引用并用合并后的资源编译全部 Story，状态栏显示待处理资源冲突数量。
- Project Resource Merge 支持缺失 Git Stage：Add/Add 可按稳定 ID 字段合并或整文件选择，Modify/Delete 明确显示 Keep/Delete；新增、覆盖和删除参与同一批验证与失败恢复，仍由作者决定何时 Git Stage。
- Story Merge 新增只读 Graph Preview：合并选择实时投影到画布，新增/修改/删除/冲突节点及连线分别着色，删除内容以幽灵元素保留；冲突列表可一键切换 Main Story / Substory 并聚焦稳定 Node ID，预览期间所有图编辑操作被锁定。
- Graph Preview 升级为交互式合并器：点击冲突节点或连线即可逐字段选择 Local / Remote，与 Story Merge 列表实时同步；已解决元素自动退出冲突色，Previous/Next 仅遍历未解决项，并支持在不写入本地章节的情况下浏览远端新增 Substory。
- Story / Project Merge 增加完成门禁与 Final Review：未决字段不再隐式采用 Local，冲突归零并通过非写入式完整预检后才可 Apply；验证绑定当前选择、Story Revision 和 Git 三阶段 SHA-256 指纹，外部 Git 变化会拒绝旧审查结果。
- 多选外框遮罩支持 Ctrl+左键穿透命中单个节点，在当前选择中切换移除 / 加回，并同步更新相关内部连线选择。
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
