# 发布页、在线更新与反馈系统规范

状态：项目级标准规范  
适用范围：Story Blueprint 官方发布站点、版本分发、客户端在线更新、AI 规范版本化同步、以及用户/AI 反馈系统。

---

## 1. 架构总览

Story Blueprint 采用**轻量、安全、解耦**的分发与反馈体系：
- **发布页与更新源**：由私有服务器统一托管静态更新清单与安装包（默认源：`https://storyblueprint.biaozi.biz:8443/updates`）；
- **客户端防篡改校验**：全量与增量包受 Ed25519 非对称签名和 SHA-512 完整性校验保护；
- **AI 规范双层解耦**：区分用户自有用例（`AGENTS.md`）与框架系统规范（`STORY_BLUEPRINT_AI.md`），升级时绝不覆盖用户资产；
- **问题反馈直通 GitHub**：客户端将环境、堆栈及 AI 诊断信息结构化封装，一键直达 GitHub Issues 统一追踪。

```
                         [ 私有服务器 Release Portal ]
                 https://storyblueprint.biaozi.biz:8443/updates
                     ├── stable.json (Ed25519 签名清单)
                     ├── StoryBlueprint-Setup-x64.exe (NSIS)
                     └── StoryBlueprint-Portable-x64.exe (Portable)
                                  │
                                  ▼
                     [ Story Blueprint 编辑器 ]
             ┌────────────────────┴────────────────────┐
             ▼                                         ▼
   [ 更新模块 (UpdateClient) ]               [ 双通道反馈 (FeedbackDialog) ]
   - 定期 / 手动检查更新                     - 用户反馈: 缺陷 / 改进建议
   - SHA-512 / Ed25519 验签                  - AI 诊断: 模型格式缺陷 / 堆栈
   - 框架 AI 规范增量安全同步                            │
   (STORY_BLUEPRINT_AI.md)                             ▼
                                           [ GitHub Issues 跟踪池 ]
                                   Cola-s-Commune/StoryBlueprint/issues
```

---

## 2. 发布服务器托管规范

### 2.1 目录组织结构

服务器的 Web 根目录（如 Nginx 静态站点）需开放以下路径：

```text
/ (Web 门户根目录, 对应仓库 portal/)
├── index.html                         # 现代化官方发布与下载门户主页
├── styles.css                         # 蓝图深色科技质感样式
├── app.js                             # 动态拉取 Manifest 与下载交互逻辑
├── assets/                            # Logo、图标与媒体静态资产
└── updates/                           # 客户端在线更新源与发行包产物（对应仓库 release/）
    ├── stable.json                    # 稳定版更新元数据清单（必需）
    ├── beta.json                      # 测试版更新元数据清单（可选）
    ├── StoryBlueprint-Setup-0.1.0-x64.exe  # Windows NSIS 安装包
    ├── StoryBlueprint-Portable-0.1.0-x64.exe # Windows 便携绿色版
    └── unity-adapter.json                 # Unity UPM 包 ID、Git 安装地址及版本
```

### 2.2 更新清单协议契约 (`UpdateManifest`)

Unity Adapter 使用独立的 `unity-adapter.json` 安装元数据，不参与编辑器自更新。
UPM 源码作为嵌入式包维护在 RuntimeDemo 项目的 Packages 目录中，包清单声明 Newtonsoft
JSON 和 uGUI 依赖。门户展示 Git URL；用户从 Package Manager 添加后由 UPM 解析依赖。
执行 `npm run release:unity` 会校验 UPM 包并生成安装元数据；执行 `npm run deploy:unity`
会部署元数据和门户页面。UPM 源码须先推送到 GitHub。完整部署
`npm run deploy -- --portal` 也包含安装元数据。

`stable.json` 和 `beta.json` 必须满足以下 JSON 规范，且根字段通过 Ed25519 私钥签名：

```json
{
  "format": "story-blueprint-update",
  "version": 1,
  "channel": "stable",
  "latestVersion": "0.1.0",
  "releaseDate": "2026-10-01T12:00:00.000Z",
  "notes": "### 0.1.0 更新日志\n- 支持官方发布页与在线更新检测\n- 接入用户与 AI 双通道 GitHub 反馈面板\n- 重构 AI Instructions 为双层解耦架构",
  "installerUrl": "./StoryBlueprint-Setup-0.1.0-x64.exe",
  "portableUrl": "./StoryBlueprint-Portable-0.1.0-x64.exe",
  "installerSha512": "<Base64-SHA512>",
  "portableSha512": "<Base64-SHA512>",
  "installerSize": 89452010,
  "portableSize": 84120300,
  "signature": {
    "algorithm": "ed25519",
    "keyId": "release-2026",
    "value": "<Base64-Ed25519-Signature>"
  }
}
```

> **注意**：
> - `installerUrl` 与 `portableUrl` 可使用相对路径（如 `./StoryBlueprint-Setup-xxx.exe`），客户端会自动基于 `feedUrl` 解析出完整下载链接。
> - 签名校验：客户端使用内置的公钥表对规范化后的 JSON 进行验签，阻止中间人劫持与篡改。

### 2.3 统一发布配置文件 (`release.config.json`)

项目根目录提供统一的发布与联调配置文件 `release.config.json`（支持别名 `release.conf.json`），用户可直接在此修改发布页本地端口与发版服务器地址：

```json
{
  "portal": {
    "port": 8443,
    "host": "0.0.0.0"
  },
  "server": {
    "url": "https://storyblueprint.biaozi.biz:8443",
    "feedUrl": "https://storyblueprint.biaozi.biz:8443/updates"
  },
  "release": {
    "channel": "stable",
    "keyId": "release-2026",
    "privateKeyFile": ".release-keys/release-2026.pem"
  }
}
```

- **发布页端口与主机**：`portal.port`（可通过 `npm run serve:portal -- --port <port>` 临时覆盖）；
- **发版服务器地址**：`server.url` 与 `server.feedUrl`，编辑器打包时（`npm run release:win` 或 `npm run build`）会自动将该服务器地址编译注入为客户端内置的默认更新源；
- **发版通道与密钥**：`release.channel`、`release.keyId` 与 `release.privateKeyFile`，生成签名 Manifest 时自动作为默认凭据。

---

## 3. 编辑器更新检测与增量升级机制

### 3.1 默认配置与行为
- **内置默认 Feed URL**：`https://storyblueprint.biaozi.biz:8443/updates`；
- **自动检查**：应用启动后后台静默请求 `stable.json`，仅在发现新版本时以通知形式提示；
- **手动检查**：顶部菜单 `Help -> Check for Updates...`，支持自由修改/保存自定义 Feed URL。

### 3.2 增量更新与安全执行
1. **安装包级更新**：
   - NSIS 安装包：下载校验完成后，可点击“Install and Restart”，编辑器退出并静默运行安装向导；
   - 便携绿色版：下载校验完成后，提示“Show Downloaded File”供用户手动替换。
2. **增量热更规划**：
   - 纯前端与主进程逻辑升级时，可分发增量 `app.asar`，客户端直接校验并原子替换，免去重下百兆 Electron 运行时。

---

## 4. AI Instructions 双层解耦与同步架构

### 4.1 核心问题与设计原则
- **问题背景**：用户经常在 `AGENTS.md` 中编写个人世界观设定、角色台词风格和剧情禁忌，直接覆写会导致用户数据丢失；而若不更新，框架演进产生的新节点规范和 MCP 命令约束无法生效。
- **解决方案**：实行**物理隔离与两级引用机制**。

```
项目根目录
├── AGENTS.md                 <- [用户专属入口] 引导 AI 查看框架规范，预留世界观/人设自由区
└── STORY_BLUEPRINT_AI.md     <- [框架托管规范] 带有版本注释，系统全托管，支持无痛升级
```

### 4.2 两个文件的规范内容

#### 1. 入口文件 `AGENTS.md`（永不强行覆盖）
```markdown
# Narrative Agent Guidelines (AGENTS.md)

This project is an interactive narrative blueprint authored with **Story Blueprint**.

> ⚠️ **CRITICAL FRAMEWORK RULE FOR AI AGENTS**:
> Before directly editing story logic, creating nodes, or executing MCP commands, you **MUST** read and strictly adhere to the framework specifications, node schemas, and mutation constraints defined in:
> 👉 **[STORY_BLUEPRINT_AI.md](./STORY_BLUEPRINT_AI.md)**

---

## Project Narrative World & Persona (Author Customization)

<!-- Authors: Customize your narrative tone, characters, world setting, and glossary below. Agents must strictly adhere to these settings. -->
### World Setting & Tone
...
```

#### 2. 框架规范文件 `STORY_BLUEPRINT_AI.md`（系统全自动维护）
```markdown
<!-- story-blueprint-ai-version: 8 -->
# Story Blueprint Framework Specifications (STORY_BLUEPRINT_AI.md)

This specification defines the core mental model, constraints, node schemas, and MCP collaboration workflows for Story Blueprint.
...
```

### 4.3 自动检测与安全同步机制
- **版本比对**：主进程解析 `STORY_BLUEPRINT_AI.md` 顶部的 `<!-- story-blueprint-ai-version: X -->`；
- **状态提示**：若版本落后于编辑器内置版本，AI Commands 面板状态栏高亮显示 `[升级至 vX]` 按钮；
- **安全升级执行**：
  - 自动将 `STORY_BLUEPRINT_AI.md` 替换为最新框架规范；
  - **100% 保持用户现有 `AGENTS.md` 不变**，绝不破坏用户个性化设定。

---

## 5. 用户与 AI 双通道 GitHub 反馈系统

### 5.1 数据存储与去向
所有问题、改进建议与异常诊断直连官方 GitHub Issues：  
`https://github.com/Cola-s-Commune/StoryBlueprint/issues/new`

### 5.2 双通道交互规范

| 维度 | 通道 A：人类用户反馈 | 通道 B：AI 智能体异常诊断 |
| :--- | :--- | :--- |
| **触发位置** | 菜单栏 `Help -> Report Issue / Feedback...` | AI Commands 面板指令校验失败时的 `[🐛 反馈异常]` |
| **预设分类** | 🐛 Bug 缺陷 / 💡 功能建议 | 🤖 AI / 编译器诊断 (`ai-diagnostic,bug`) |
| **自动收集上下文** | 应用版本、操作系统架构、User-Agent、时间戳 | 当前模型名称、错误提示、校验错题本、原始堆栈 |
| **提交机制** | 组装 URL 参数并在默认浏览器打开预填 Issue；备用一键复制 Markdown | 同左，诊断信息结构化进入代码块方便回溯 |

---

## 6. 发版执行清单 (Release Checklist)

发版人员在本地或 CI 构建机执行发布时，按以下步骤进行：

1. **打包产物与签名清单**：
   ```bash
   # 编译工作区包
   npm run build
   # 一键构建 Windows NSIS 安装包、便携版并生成 Ed25519 签名清单 stable.json
   npm run release:win
   ```
2. **本地双重验证**：
   ```bash
   # 自动化烟雾测试、ASAR 校验与 Ed25519 签名有效性核对
   npm run verify:release:win
   # 启动本地官方 Web 门户与更新服务（支持浏览器访问与客户端联调更新）
   npm run serve:portal
   ```
3. **部署至生产服务器**：
   - 将 `portal/` 内容部署至 Web 根目录 `/`；
   - 将 `release/` 内容（`stable.json`、`.exe`、`.blockmap`）部署至 Web 根目录的 `/updates/` 下。

