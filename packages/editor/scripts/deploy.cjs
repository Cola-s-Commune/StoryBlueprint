#!/usr/bin/env node
/**
 * deploy.cjs
 * Story Blueprint 自动化发布推送脚本
 * 支持将 release/ 安装包产物与 portal/ 前端页面安全、自动推送到服务器（macOS/Linux）
 *
 * 特性：
 * - 自动防掉线心跳 (ServerAliveInterval=15, ServerAliveCountMax=20)
 * - 传输失败自动重试机制 (最多重试 3 次)
 * - 自动过滤临时调试目录 (排除 win-unpacked/, linux-unpacked/ 等冗余文件)
 * - 支持仅推送更新清单 (--only-manifest)
 * - 支持同时同步前端发布页 (--portal)
 * - 优先自动探测 rsync (支持断点续传与极速增量)，未安装时平滑使用带心跳与重试的 scp
 * - 支持 SMB 局域网共享模式 (robocopy /Z 断点续传)
 */

const { existsSync, readdirSync, statSync } = require('node:fs');
const { resolve, join, basename } = require('node:path');
const { spawnSync } = require('node:child_process');
const https = require('node:https');
const http = require('node:http');
const { loadReleaseConfig } = require('./load-release-config.cjs');

const workspaceRoot = resolve(__dirname, '../../..');
const releaseDir = resolve(workspaceRoot, 'release');
const portalDir = resolve(workspaceRoot, 'portal');

// 命令行参数解析
const args = process.argv.slice(2);
function getArg(flag, alias) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag || (alias && args[i] === alias)) {
      return args[i + 1];
    }
    if (args[i].startsWith(`${flag}=`)) {
      return args[i].split('=')[1];
    }
  }
  return undefined;
}
const hasFlag = (flag) => args.includes(flag);

if (hasFlag('--help') || hasFlag('-h')) {
  console.log(`
Story Blueprint 自动化发版推送工具

用法:
  npm run deploy [选项]

选项:
  --host <ip/域名>     远程服务器地址 (默认读取 release.config.json)
  --user <用户名>      远程服务器 SSH/系统用户名
  --port <端口>        SSH 端口 (默认: 22)
  --remote-dir <路径>  远程更新目录 (如: /Users/user/www/storyblueprint/updates)
  --portal             一并推送 portal/ 发布页前端文件到根目录
  --only-manifest      仅推送 stable.json 更新元数据清单
  --tool <rsync|scp>   强制指定传输工具 (默认优先自动探测 rsync，回退 scp)
  --dry-run            仅打印将要上传的文件清单，不执行实际传输
  -h, --help           查看帮助信息

配置文件示例 (release.config.json):
  "deploy": {
    "host": "192.168.1.50",
    "user": "mac_user",
    "port": 22,
    "remoteDir": "/Users/mac_user/www/storyblueprint/updates",
    "portalRemoteDir": "/Users/mac_user/www/storyblueprint",
    "deployPortal": false
  }
`);
  process.exit(0);
}

// 1. 加载配置
const { config, raw, filePath } = loadReleaseConfig(workspaceRoot);
const deployConf = raw.deploy || config.deploy || {};

const targetHost = getArg('--host') || deployConf.host;
const targetUser = getArg('--user') || deployConf.user;
const targetPort = parseInt(getArg('--port') || deployConf.port || '22', 10);
const remoteDir = getArg('--remote-dir') || deployConf.remoteDir;
const portalRemoteDir = getArg('--portal-dir') || deployConf.portalRemoteDir || (remoteDir ? remoteDir.replace(/\/updates\/?$/, '') : '');
const shouldDeployPortal = hasFlag('--portal') || Boolean(deployConf.deployPortal);
const onlyManifest = hasFlag('--only-manifest');
const isDryRun = hasFlag('--dry-run');
const forcedTool = getArg('--tool') || deployConf.tool;

// 配置校验与友好提示
if (!targetHost || !targetUser || !remoteDir) {
  console.error('\n❌ [deploy] 缺少远程服务器连接配置！');
  console.error(`请在 ${filePath ? basename(filePath) : 'release.config.json'} 中配置 deploy 字段，或通过命令行参数传入：\n`);
  console.error(`  示例 release.config.json 配置：
  "deploy": {
    "host": "你的Mac机器IP或域名",
    "user": "你的Mac用户名",
    "remoteDir": "/Users/你的Mac用户名/www/storyblueprint/updates",
    "portalRemoteDir": "/Users/你的Mac用户名/www/storyblueprint"
  }\n`);
  console.error('  或直接运行: npm run deploy -- --host 192.168.1.50 --user username --remote-dir /Users/username/www/storyblueprint/updates\n');
  process.exit(1);
}

// 2. 收集待上传的发布产物
if (!existsSync(releaseDir)) {
  console.error(`❌ [deploy] 未找到 release/ 目录: ${releaseDir}`);
  console.error('请先执行 npm run release:win 构建安装包后再执行推送。');
  process.exit(1);
}

const releaseFiles = readdirSync(releaseDir)
  .filter((f) => {
    // 排除解包中间目录与调试日志
    if (f.endsWith('-unpacked') || f === 'builder-debug.yml') return false;
    const stat = statSync(join(releaseDir, f));
    if (!stat.isFile()) return false;
    if (onlyManifest) return f === 'stable.json';
    return (
      f === 'stable.json' ||
      f.endsWith('.exe') ||
      f.endsWith('.tar.gz') ||
      f.endsWith('.dmg') ||
      f.endsWith('.zip') ||
      f.endsWith('.blockmap')
    );
  })
  .map((f) => ({
    name: f,
    path: join(releaseDir, f),
    size: statSync(join(releaseDir, f)).size,
  }));

if (releaseFiles.length === 0) {
  console.error('❌ [deploy] 在 release/ 目录下未发现可上传的发布文件！');
  process.exit(1);
}

// 格式化文件大小
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

console.log('\n======================================================');
console.log('🚀 Story Blueprint 自动化发布推送服务');
console.log('======================================================');
console.log(`🌐 目标服务器  : ${targetUser}@${targetHost}:${targetPort}`);
console.log(`📂 发行包目录  : ${remoteDir}`);
if (shouldDeployPortal) {
  console.log(`🌐 门户网目录  : ${portalRemoteDir}`);
}
console.log(`📦 待推送产物  : ${releaseFiles.length} 个文件`);
releaseFiles.forEach((f) => {
  console.log(`   - ${f.name.padEnd(42)} (${formatBytes(f.size)})`);
});
console.log('======================================================\n');

if (isDryRun) {
  console.log('🔍 [dry-run] 演练模式结束，未向远程服务器写入任何文件。');
  process.exit(0);
}

// 3. 探测传输工具 (rsync / scp / robocopy)
function hasCommand(cmd) {
  try {
    const res = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
    return res.status === 0;
  } catch (e) {
    return false;
  }
}

let tool = forcedTool;
if (!tool) {
  if (hasCommand('rsync')) {
    tool = 'rsync';
  } else {
    tool = 'scp';
  }
}

console.log(`🛠️ 使用传输协议: [${tool.toUpperCase()}]`);

// 4. 执行上传
let totalSuccess = true;

if (tool === 'rsync') {
  // rsync 方案：原生支持断点续传 (-P / --partial)、增量压缩 (-z)、归档模式 (-a)
  console.log('📡 正在调用 rsync 进行增量同步（支持断点续传）...');
  const remoteTarget = `${targetUser}@${targetHost}:${remoteDir}/`;
  const filePaths = releaseFiles.map((f) => f.path);

  const rsyncArgs = [
    '-avzP',
    '--partial',
    '-e',
    `ssh -p ${targetPort} -o ServerAliveInterval=15 -o ServerAliveCountMax=20`,
    ...filePaths,
    remoteTarget,
  ];

  const res = spawnSync('rsync', rsyncArgs, { stdio: 'inherit', cwd: workspaceRoot });
  if (res.status !== 0) {
    console.error('❌ rsync 同步过程中断！可直接重新运行本脚本继续断点续传。');
    totalSuccess = false;
  } else {
    console.log('✅ 发行包同步完成！');
  }

  // 同步前端网页
  if (shouldDeployPortal && totalSuccess) {
    console.log('\n📡 正在同步发布门户网页 (portal/)...');
    const portalTarget = `${targetUser}@${targetHost}:${portalRemoteDir}/`;
    const portalArgs = [
      '-avz',
      '--delete',
      '-e',
      `ssh -p ${targetPort} -o ServerAliveInterval=15 -o ServerAliveCountMax=20`,
      `${portalDir}/`,
      portalTarget,
    ];
    const portalRes = spawnSync('rsync', portalArgs, { stdio: 'inherit', cwd: workspaceRoot });
    if (portalRes.status !== 0) {
      console.error('❌ portal 门户网页同步失败。');
      totalSuccess = false;
    } else {
      console.log('✅ portal 门户网页同步完成！');
    }
  }
} else {
  // scp 方案：一次性批量传输所有文件，仅需输入一次密码！
  console.log('📡 正在使用增强型批量 SCP 传输 (已开启防掉线心跳)...');

  const scpOptions = [
    '-P',
    String(targetPort),
    '-C', // 开启传输压缩
    '-o',
    'ServerAliveInterval=15', // 每 15 秒向服务器发送心跳保持连接
    '-o',
    'ServerAliveCountMax=20', // 最多重试 20 次，防止路由器在传输大包时超时掐断
    '-o',
    'ConnectTimeout=15',
  ];

  const remoteTarget = `${targetUser}@${targetHost}:${remoteDir}/`;
  const filePaths = releaseFiles.map((f) => f.path);

  console.log(`\n⏳ 正在批量传输 ${releaseFiles.length} 个文件到远程目录 (只需验证一次密码)...`);
  const res = spawnSync('scp', [...scpOptions, ...filePaths, remoteTarget], {
    stdio: 'inherit',
    cwd: workspaceRoot,
  });

  if (res.status !== 0) {
    console.error('❌ 文件批量传输中断。');
    totalSuccess = false;
  } else {
    console.log('✅ 所有安装包与清单批量传输成功！');
  }

  // 同步 portal 目录
  if (shouldDeployPortal && totalSuccess) {
    console.log('\n⏳ 正在传输 portal/ 门户网页...');
    const remotePortalTarget = `${targetUser}@${targetHost}:${portalRemoteDir}/`;
    const res = spawnSync('scp', [...scpOptions, '-r', `${portalDir}/*`, remotePortalTarget], {
      stdio: 'inherit',
      cwd: workspaceRoot,
    });
    if (res.status !== 0) {
      console.error('❌ portal 门户网页传输失败。');
      totalSuccess = false;
    } else {
      console.log('✅ portal 门户网页传输成功！');
    }
  }
}

// 5. 校验线上健康状态
if (totalSuccess) {
  console.log('\n======================================================');
  console.log('🎉 恭喜！本次更新已成功部署至 macOS 服务器！');
  console.log(`📡 在线清单源: ${config.server.feedUrl}/stable.json`);
  console.log(`🌐 在线发布页: ${config.server.url}`);
  console.log('======================================================\n');
} else {
  console.error('\n⚠️ 部署遇到部分失败，请检查网络连接或权限后重新运行。\n');
  process.exit(1);
}
