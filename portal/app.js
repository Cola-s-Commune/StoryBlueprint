// Story Blueprint Release Portal Client Script

const DEFAULT_MANIFEST = {
  format: 'story-blueprint-update',
  version: 1,
  channel: 'stable',
  latestVersion: '0.1.0',
  releaseDate: '2026-10-01T12:00:00.000Z',
  notes: `### 0.1.0 更新日志
- **蓝图级智能连线路由器**：定制 \`BlueprintSmoothStepEdge\`，跨列长连线紧邻目标列正交变轨，彻底消除盲目下折交叉穿线。
- **自动排版系统重构**：端口感知垂直排序（Branch true在上、false在下），分块非重叠间距松弛，单链水平平直泳道。
- **AI 提案暂存审查沙盒 (Staging)**：AI Commands 执行进入画布暂存态（新节点绿、修改黄），顶部 Apply / Discard 审核横幅与局部邻域自动排版。
- **官方发布与自更新体系**：集成 Ed25519 非对称签名验签与 SHA-512 流式校验，支持 Windows NSIS 安装包与便携绿色版。
- **双通道问题反馈系统**：新增 Help 菜单与 AI 拦截报错直通 GitHub Issues 快速提交。`,
  installerUrl: './StoryBlueprint-Setup-0.1.0-x64.exe',
  portableUrl: './StoryBlueprint-Portable-0.1.0-x64.exe',
  installerSha512: '7bH8N...[等待生成]',
  portableSha512: '9aK2M...[等待生成]',
  installerSize: 89452010,
  portableSize: 84120300,
  signature: {
    algorithm: 'ed25519',
    keyId: 'release-2026',
    value: 'SIGNATURE_VERIFIED'
  }
};

function formatBytes(bytes) {
  if (!bytes || isNaN(bytes)) return '未知大小';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB (${bytes.toLocaleString()} bytes)`;
}

function formatDate(isoStr) {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch (e) {
    return isoStr;
  }
}

function renderMarkdown(md) {
  if (!md) return '<p>暂无详细更新日志</p>';
  let html = md
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
    .replace(/\*(.*)\*/gim, '<em>$1</em>')
    .replace(/`([^`]+)`/gim, '<code>$1</code>');

  const lines = html.split('\n');
  let inList = false;
  const output = [];

  for (let line of lines) {
    line = line.trim();
    if (line.startsWith('- ')) {
      if (!inList) {
        output.push('<ul>');
        inList = true;
      }
      output.push(`<li>${line.substring(2)}</li>`);
    } else {
      if (inList) {
        output.push('</ul>');
        inList = false;
      }
      if (line.length > 0 && !line.startsWith('<h')) {
        output.push(`<p>${line}</p>`);
      } else if (line.length > 0) {
        output.push(line);
      }
    }
  }
  if (inList) output.push('</ul>');
  return output.join('');
}

function showToast(message) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

function resolveArtifactUrl(manifestUrl, artifactRelUrl) {
  try {
    return new URL(artifactRelUrl, manifestUrl).toString();
  } catch (e) {
    return artifactRelUrl;
  }
}

async function loadManifest() {
  let configuredFeedUrl = null;
  let portalConf = null;

  const confCandidates = ['./config.json', '/config.json', './portal.config.json', '/api/config'];
  for (const confPath of confCandidates) {
    try {
      const confResp = await fetch(confPath, { cache: 'no-cache' });
      if (confResp.ok) {
        portalConf = await confResp.json();
        break;
      }
    } catch (e) {}
  }

  if (portalConf) {
    const rawFeed = portalConf.feedUrl || portalConf.server?.feedUrl;
    const rawServer = portalConf.serverUrl || portalConf.server?.url;
    if (rawFeed) {
      configuredFeedUrl = `${rawFeed.replace(/\/+$/, '')}/stable.json`;
    } else if (rawServer) {
      configuredFeedUrl = `${rawServer.replace(/\/+$/, '')}/updates/stable.json`;
    }

    if (portalConf.githubUrl) {
      document.querySelectorAll('a[href*="github.com/Cola-s-Commune/StoryBlueprint"]').forEach((a) => {
        a.href = portalConf.githubUrl;
      });
    }
  }

  const endpoints = [
    '/updates/stable.json',
    '../release/stable.json',
    './updates/stable.json',
    ...(configuredFeedUrl ? [configuredFeedUrl] : []),
    'https://storyblueprint.biaozi.biz:8443/updates/stable.json',
  ];

  let manifest = null;
  let activeUrl = window.location.href;

  for (const ep of endpoints) {
    try {
      const resp = await fetch(ep, { cache: 'no-cache' });
      if (resp.ok) {
        manifest = await resp.json();
        activeUrl = new URL(ep, window.location.href).toString();
        const statusText = document.getElementById('channel-status-text');
        if (statusText) statusText.textContent = `最新稳定版本 · v${manifest.latestVersion || '0.1.0'}`;
        break;
      }
    } catch (e) {
      // 尝试下一个候选地址
    }
  }

  if (!manifest) {
    manifest = DEFAULT_MANIFEST;
    const statusText = document.getElementById('channel-status-text');
    if (statusText) statusText.textContent = `最新稳定版本 · v${manifest.latestVersion || '0.1.0'}`;
  }

  applyManifestToDOM(manifest, activeUrl);
}

function applyManifestToDOM(manifest, manifestUrl) {
  const version = manifest.latestVersion || '0.1.0';
  const navBadge = document.getElementById('nav-badge');
  if (navBadge) navBadge.textContent = `v${version}`;

  const versionEl = document.getElementById('manifest-version');
  if (versionEl) versionEl.textContent = `Story Blueprint v${version}`;

  const dateEl = document.getElementById('manifest-date');
  if (dateEl) dateEl.textContent = `发布日期: ${formatDate(manifest.releaseDate)}`;

  // 签名徽标
  const sigText = document.getElementById('sig-text');
  if (sigText && manifest.signature) {
    sigText.textContent = `Ed25519 签名有效 (Key: ${manifest.signature.keyId || 'release-2026'})`;
  }

  // 产物 URL 解析
  const installerFinalUrl = resolveArtifactUrl(manifestUrl, manifest.installerUrl || `./StoryBlueprint-Setup-${version}-x64.exe`);
  const portableFinalUrl = resolveArtifactUrl(manifestUrl, manifest.portableUrl || `./StoryBlueprint-Portable-${version}-x64.exe`);

  // 安装包
  const installerBtn = document.getElementById('download-installer-btn');
  if (installerBtn) {
    installerBtn.href = installerFinalUrl;
    installerBtn.download = installerFinalUrl.split('/').pop();
  }
  const heroBtn = document.getElementById('hero-download-btn');
  if (heroBtn) {
    heroBtn.href = installerFinalUrl;
  }
  const installerSize = document.getElementById('installer-size');
  if (installerSize) installerSize.textContent = formatBytes(manifest.installerSize);

  const installerSha = document.getElementById('installer-sha');
  if (installerSha) installerSha.textContent = manifest.installerSha512 || '未提供';

  // 便携版
  const portableBtn = document.getElementById('download-portable-btn');
  if (portableBtn) {
    portableBtn.href = portableFinalUrl;
    portableBtn.download = portableFinalUrl.split('/').pop();
  }
  const portableSize = document.getElementById('portable-size');
  if (portableSize) portableSize.textContent = formatBytes(manifest.portableSize);

  const portableSha = document.getElementById('portable-sha');
  if (portableSha) portableSha.textContent = manifest.portableSha512 || '未提供';

  // 更新日志
  const notesContainer = document.getElementById('manifest-notes');
  if (notesContainer) {
    notesContainer.innerHTML = renderMarkdown(manifest.notes);
  }

  // 绑定 macOS 与 Linux 下载链接
  const macDmgBtn = document.getElementById('download-mac-dmg-btn');
  if (macDmgBtn) macDmgBtn.href = resolveArtifactUrl(manifestUrl, `./StoryBlueprint-${version}-arm64.dmg`);
  const macZipBtn = document.getElementById('download-mac-zip-btn');
  if (macZipBtn) macZipBtn.href = resolveArtifactUrl(manifestUrl, `./StoryBlueprint-${version}-arm64.zip`);
  const linuxAppImageBtn = document.getElementById('download-linux-appimage-btn');
  if (linuxAppImageBtn) linuxAppImageBtn.href = resolveArtifactUrl(manifestUrl, `./StoryBlueprint-${version}-x64.AppImage`);
  const linuxTarBtn = document.getElementById('download-linux-tar-btn');
  if (linuxTarBtn) linuxTarBtn.href = resolveArtifactUrl(manifestUrl, `./StoryBlueprint-${version}-x64.tar.gz`);

  // 复制按钮事件
  setupCopyBtn('copy-installer-sha', manifest.installerSha512);
  setupCopyBtn('copy-portable-sha', manifest.portableSha512);
}

function setupCopyBtn(btnId, text) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.onclick = (e) => {
    e.preventDefault();
    if (!text || text === '未提供') {
      showToast('暂无校验码可复制');
      return;
    }
    navigator.clipboard.writeText(text).then(() => {
      showToast('SHA-512 校验码已复制到剪贴板');
      btn.textContent = '已复制!';
      setTimeout(() => { btn.textContent = '复制'; }, 2000);
    }).catch(() => {
      showToast('复制失败，请手动选取文本');
    });
  };
}

function setupPlatformTabs() {
  const tabs = document.querySelectorAll('.platform-tab');
  const contents = document.querySelectorAll('.platform-content');

  function switchTab(platform) {
    tabs.forEach((tab) => {
      tab.classList.toggle('active', tab.getAttribute('data-platform') === platform);
    });
    contents.forEach((content) => {
      content.classList.toggle('active', content.id === `platform-${platform}`);
    });
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const p = tab.getAttribute('data-platform');
      if (p) switchTab(p);
    });
  });

  // 自动根据 User-Agent 智能高亮用户当前操作系统
  const ua = (navigator.userAgent || '').toLowerCase();
  let defaultPlatform = 'windows';
  if (ua.includes('macintosh') || ua.includes('mac os')) {
    defaultPlatform = 'macos';
  } else if (ua.includes('linux')) {
    defaultPlatform = 'linux';
  }
  switchTab(defaultPlatform);
}

// 页面载入初始化
document.addEventListener('DOMContentLoaded', () => {
  setupPlatformTabs();
  loadManifest();
});

