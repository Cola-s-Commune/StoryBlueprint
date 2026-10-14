const { existsSync, readFileSync } = require('node:fs');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const workspaceRoot = path.resolve(__dirname, '..');
const portalRoot = path.resolve(__dirname);
const releaseRoot = path.resolve(workspaceRoot, 'release');

// 加载 release.config.json 或 release.conf.json
function loadConf() {
  // 优先查找 portal 目录下的专属配置文件，再回退到根目录全局配置
  const candidates = [
    { dir: portalRoot, name: 'config.local.json' },
    { dir: portalRoot, name: 'config.json' },
    { dir: portalRoot, name: 'portal.config.json' },
    { dir: workspaceRoot, name: 'release.config.local.json' },
    { dir: workspaceRoot, name: 'release.config.json' },
    { dir: workspaceRoot, name: 'release.conf.json' },
    { dir: workspaceRoot, name: 'release.conf' },
  ];

  for (const { dir, name } of candidates) {
    const p = path.resolve(dir, name);
    if (existsSync(p)) {
      try {
        const raw = JSON.parse(readFileSync(p, 'utf8'));
        const relativeName = path.relative(workspaceRoot, p);
        return { file: relativeName, fullPath: p, data: raw };
      } catch (e) {
        console.warn(`[portal] 警告: 配置文件 ${name} 解析失败:`, e.message);
      }
    }
  }
  return { file: null, fullPath: null, data: {} };
}

const conf = loadConf();
const args = process.argv.slice(2);
function getArg(flags) {
  for (let i = 0; i < args.length; i++) {
    if (flags.includes(args[i]) && args[i + 1]) return args[i + 1];
  }
  return undefined;
}

const cliPort = getArg(['--port', '-p']);
const cliHost = getArg(['--host', '-h']);

const rawData = conf.data || {};
const confPort = rawData.port ?? rawData.portal?.port;
const confHost = rawData.host ?? rawData.portal?.host;
const confServerUrl = rawData.serverUrl ?? rawData.server?.url ?? 'https://storyblueprint.biaozi.biz:8443';
const confFeedUrl =
  rawData.feedUrl ??
  rawData.server?.feedUrl ??
  (confServerUrl ? `${confServerUrl.replace(/\/+$/, '')}/updates` : 'https://storyblueprint.biaozi.biz:8443/updates');

const PORT = parseInt(cliPort || process.env.PORT || confPort || '8443', 10);
const HOST = cliHost || process.env.HOST || confHost || '0.0.0.0';
const SERVER_URL = confServerUrl;
const SERVER_FEED = confFeedUrl;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.exe': 'application/vnd.microsoft.portable-executable',
  '.zip': 'application/zip',
  '.unitypackage': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
};

function serveFile(req, res, filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`404 Not Found: ${req.url}`);
    return;
  }

  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  // 支持 Range 断点续传
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;

    if (start >= stat.size || end >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      res.end();
      return;
    }

    const chunksize = end - start + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': stat.size,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': ['.json', '.css', '.js', '.html'].includes(ext)
        ? 'no-cache, no-store, must-revalidate'
        : 'public, max-age=3600',
    });
    fs.createReadStream(filePath).pipe(res);
  }
}

const CANDIDATE_RELEASE_DIRS = [
  path.resolve(portalRoot, 'updates'),
  path.resolve(workspaceRoot, 'release'),
  path.resolve(workspaceRoot, 'updates'),
  path.resolve(portalRoot),
];

// 如果配置中有额外指定目录，也加入检索
if (rawData.deploy?.remoteDir) {
  CANDIDATE_RELEASE_DIRS.push(path.resolve(rawData.deploy.remoteDir));
}
if (rawData.releaseDir) {
  CANDIDATE_RELEASE_DIRS.push(path.resolve(rawData.releaseDir));
}

function findReleaseFile(filename) {
  const safeName = path.basename(filename);
  for (const dir of CANDIDATE_RELEASE_DIRS) {
    const candidate = path.resolve(dir, safeName);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(parsedUrl.pathname);

  // 0. /api/config 返回当前 release 配置
  if (pathname === '/api/config' || pathname === '/release.config.json') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
    });
    res.end(JSON.stringify(conf.data, null, 2));
    return;
  }

  // 1. /updates/* 路由到 release/updates 产物目录
  if (pathname.startsWith('/updates/')) {
    const subPath = pathname.replace(/^\/updates\//, '');
    const found = findReleaseFile(subPath);
    if (found) {
      serveFile(req, res, found);
      return;
    }
    // 回退到 releaseRoot 路径
    const targetFile = path.resolve(releaseRoot, subPath);
    serveFile(req, res, targetFile);
    return;
  }

  // 2. 根目录直接请求安装包或更新清单（例如 /StoryBlueprint-Setup-0.1.0-x64.exe 或 /stable.json）
  const isReleaseArtifact =
    pathname === '/stable.json' ||
    pathname.endsWith('.exe') ||
    pathname.endsWith('.dmg') ||
    pathname.endsWith('.tar.gz') ||
    pathname.endsWith('.zip') ||
    pathname.endsWith('.AppImage') ||
    pathname.endsWith('.blockmap');

  if (isReleaseArtifact) {
    const fileName = path.basename(pathname);
    const found = findReleaseFile(fileName);
    if (found) {
      serveFile(req, res, found);
      return;
    }
  }

  // 3. 其余静态页面请求路由到 portal 目录
  if (pathname === '/' || pathname === '') {
    pathname = '/index.html';
  }
  const targetFile = path.resolve(portalRoot, pathname.replace(/^\//, ''));
  if (!targetFile.startsWith(portalRoot)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  serveFile(req, res, targetFile);
});

server.listen(PORT, HOST, () => {
  console.log(`\n========================================================`);
  console.log(`🚀 Story Blueprint 发布门户 & 更新服务已启动:`);
  if (conf.file) {
    console.log(`⚙️ 已加载配置文件   : ${conf.file}`);
  } else {
    console.log(`⚙️ 配置文件状态     : 未找到 release.config.json (使用默认配置)`);
  }
  console.log(`🌐 Web 发布门户地址 : http://localhost:${PORT}`);
  console.log(`📡 更新源 Feed 地址 : http://localhost:${PORT}/updates/stable.json`);
  console.log(`☁️ 外部生产服务器   : ${SERVER_URL}`);
  console.log(`📂 产物检索目录列表 :`);
  CANDIDATE_RELEASE_DIRS.forEach((d) => {
    const exists = fs.existsSync(d);
    console.log(`   ${exists ? '✓ (有效)' : '✗ (不存在)'} ${d}`);
  });
  console.log(`========================================================\n`);
});

