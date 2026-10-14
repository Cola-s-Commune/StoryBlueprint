# npm 命令速查

仓库使用 npm Workspaces。以下命令均从仓库根目录运行；Node.js 需满足 `>=22.12.0`（见 `.nvmrc` 与 `package.json`）。

## 日常开发

| 命令                   | 用途                                          |
| ---------------------- | --------------------------------------------- |
| `npm install`          | 安装根目录及所有 Workspace 依赖               |
| `npm run dev`          | 启动 Electron + Vite 开发环境                 |
| `npm run build`        | 构建所有 Workspace 包                         |
| `npm run typecheck`    | 构建 common 类型入口并检查所有包的 TypeScript |
| `npm run lint`         | 对所有 Workspace 源码运行 ESLint              |
| `npm test`             | 运行全部 Vitest 测试                          |
| `npm run format:check` | 检查 Prettier 格式                            |

## 本地调试发布门户

```powershell
npm run serve:portal
npm run serve:portal -- --port 8080
```

门户根路径提供 Web 页面，`/updates/` 提供 `release/` 下的更新 Feed 和产物。也可单独用静态服务器验证更新检查：

```powershell
python -m http.server 8080 --directory release
```

在应用 `Help → Check for Updates...` 中将 Feed URL 指向 `http://localhost:8080/`。

## 版本与 Windows 发布

| 命令                            | 用途                                                                 |
| ------------------------------- | -------------------------------------------------------------------- |
| `npm run version:set -- 0.1.2`  | 更新根包与 Workspace 版本；先检查脚本输出，再提交版本变更            |
| `npm run release:win:dir`       | 生成 Windows x64 解包目录版本                                        |
| `npm run release:win:portable`  | 生成 Windows x64 Portable EXE                                        |
| `npm run release:win:installer` | 生成 Windows x64 NSIS 安装程序                                       |
| `npm run release:win:manifest`  | 基于已有产物生成稳定版/预发布更新清单                                |
| `npm run release:win`           | 构建安装程序和 Portable，并生成签名更新清单                          |
| `npm run verify:release:win`    | 验证包内容、启动 smoke test、Manifest、大小、SHA-512 与 Ed25519 签名 |
| `npm run release:keygen`        | 首次配置更新签名密钥；仅在确认密钥存储策略后运行                     |

发行产物位于 `release/`。Manifest 需要更新私钥和客户端已信任的 key ID，推荐通过 Secret 或环境变量提供：

- `STORY_BLUEPRINT_UPDATE_PRIVATE_KEY` 或 `STORY_BLUEPRINT_UPDATE_PRIVATE_KEY_FILE`
- `STORY_BLUEPRINT_UPDATE_KEY_ID`
- `STORY_BLUEPRINT_UPDATE_CHANNEL`（默认根据版本选择 stable / beta）
- `STORY_BLUEPRINT_RELEASE_NOTES` 或 `STORY_BLUEPRINT_RELEASE_NOTES_FILE`

私钥不得提交到 Git。`release:keygen` 会更新客户端公钥表并创建私钥文件；生成前应确认 `.release-keys/` 的备份和权限。

## 部署

```powershell
npm run deploy
npm run deploy -- --portal
npm run deploy:portal
npm run deploy:unity
npm run release:unity
npm run release:deploy
```

- `release:unity` 校验 Unity 原生导出的 `integrations/unity/StoryBlueprintAdapter.unitypackage` 与当前源码一致，复制到 `release/` 并生成 `unity-adapter.json`（版本、大小、SHA-512）。
- `deploy` 自动执行 Unity Adapter 发布准备，并上传现有 `release/` 更新产物及 Unity 包。源码变更后需要先在 RuntimeDemo 重新原生导出；过期或缺失的包会阻止部署。
- `deploy -- --portal` 同时部署更新产物与 `portal/`。
- `deploy:portal` 只部署门户。
- `deploy:unity` 校验并部署 Unity Adapter 包、下载元数据及门户页面。部署前可执行 `npm run deploy:unity -- --dry-run` 查看清单。
- `release:deploy` 依次构建 Windows 安装器、Portable、签名 Manifest 并部署。

部署需在本地 `release.config.json` 配置主机、用户、远程目录和目标方式；该文件包含环境信息，不应提交。可使用 `npm run deploy -- --help` 查看脚本支持的参数。

## 跨平台打包脚本

```powershell
npm run release:linux:tar
npm run release:linux:tar:arm64
npm run release:linux:appimage
npm run release:linux:appimage:arm64
npm run release:mac:dmg
```

Linux / macOS 打包依赖对应平台的构建环境和 Electron Builder 工具链；Windows 上交叉构建不保证可用。macOS ZIP 目标目前仅在 editor Workspace 暴露：`npm run release:mac:zip --workspace @story-blueprint/editor`。

## npm Workspaces 定向命令

需要只操作某个包时，可使用：

```powershell
npm run build --workspace @story-blueprint/editor
npm run typecheck --workspace @story-blueprint/runtime
npm run test -- --reporter=verbose
```

根级 `test` 命令适用于全套测试；测试文件位于 `tests/`，Vitest 参数应在 `--` 后传递。
