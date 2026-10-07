#!/usr/bin/env node
/**
 * set-version.cjs
 * 一键同步更新 Story Blueprint 所有包及前端发布页的版本号
 *
 * 用法:
 *   npm run version:set <新版本号>
 * 例如:
 *   npm run version:set 0.2.0
 */

const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const { resolve, join } = require('node:path');

const newVersion = process.argv[2];

if (!newVersion) {
  console.error('\n❌ 请提供新版本号！');
  console.error('用法: npm run version:set <新版本号>');
  console.error('例如: npm run version:set 0.2.0\n');
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(newVersion)) {
  console.error(`\n❌ 版本号格式不合法 (必须是语义化版本 SemVer，例如 0.2.0 或 1.0.0-beta.1): ${newVersion}\n`);
  process.exit(1);
}

const workspaceRoot = resolve(__dirname, '../../..');

const packageJsonPaths = [
  resolve(workspaceRoot, 'package.json'),
  resolve(workspaceRoot, 'packages/editor/package.json'),
  resolve(workspaceRoot, 'packages/common/package.json'),
  resolve(workspaceRoot, 'packages/compiler/package.json'),
  resolve(workspaceRoot, 'packages/runtime/package.json'),
  resolve(workspaceRoot, 'packages/mcp-server/package.json'),
  resolve(workspaceRoot, 'packages/sdk/package.json'),
];

console.log(`\n======================================================`);
console.log(`🚀 正在将项目版本号统一升级至: [ v${newVersion} ]`);
console.log(`======================================================`);

// 1. 更新所有 package.json
for (const p of packageJsonPaths) {
  if (existsSync(p)) {
    try {
      const content = JSON.parse(readFileSync(p, 'utf8'));
      const oldVer = content.version;
      content.version = newVersion;
      writeFileSync(p, JSON.stringify(content, null, 2) + '\n', 'utf8');
      console.log(`✓ 已更新: ${p.replace(workspaceRoot, '')} (v${oldVer} -> v${newVersion})`);
    } catch (e) {
      console.warn(`⚠️ 更新失败: ${p}`, e.message);
    }
  }
}

// 2. 更新 portal/app.js 默认兜底版本
const portalAppJs = resolve(workspaceRoot, 'portal/app.js');
if (existsSync(portalAppJs)) {
  try {
    let js = readFileSync(portalAppJs, 'utf8');
    js = js.replace(/latestVersion:\s*'[^']+'/, `latestVersion: '${newVersion}'`);
    js = js.replace(/StoryBlueprint-Setup-[0-9A-Za-z.-]+-x64\.exe/g, `StoryBlueprint-Setup-${newVersion}-x64.exe`);
    js = js.replace(/StoryBlueprint-Portable-[0-9A-Za-z.-]+-x64\.exe/g, `StoryBlueprint-Portable-${newVersion}-x64.exe`);
    writeFileSync(portalAppJs, js, 'utf8');
    console.log(`✓ 已更新: /portal/app.js 默认兜底产物链接`);
  } catch (e) {
    console.warn('⚠️ 更新 portal/app.js 失败:', e.message);
  }
}

// 3. 更新 portal/index.html 默认展示版本
const portalIndexHtml = resolve(workspaceRoot, 'portal/index.html');
if (existsSync(portalIndexHtml)) {
  try {
    let html = readFileSync(portalIndexHtml, 'utf8');
    html = html.replace(/Story Blueprint v\d+\.\d+\.\d+[0-9A-Za-z.-]*/g, `Story Blueprint v${newVersion}`);
    html = html.replace(/StoryBlueprint-Setup-[0-9A-Za-z.-]+-x64\.exe/g, `StoryBlueprint-Setup-${newVersion}-x64.exe`);
    html = html.replace(/StoryBlueprint-Portable-[0-9A-Za-z.-]+-x64\.exe/g, `StoryBlueprint-Portable-${newVersion}-x64.exe`);
    writeFileSync(portalIndexHtml, html, 'utf8');
    console.log(`✓ 已更新: /portal/index.html 静态展示与下载兜底`);
  } catch (e) {
    console.warn('⚠️ 更新 portal/index.html 失败:', e.message);
  }
}

console.log(`======================================================`);
console.log(`🎉 版本号已全部同步为 v${newVersion}！`);
console.log(`\n后续发布新版本流程:`);
console.log(`  1. 构建新版本安装包:   npm run release:win`);
console.log(`  2. 推送新版本到服务器: npm run deploy -- --portal`);
console.log(`======================================================\n`);
