const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const candidates = [
  'release.config.json',
  'release.conf.json',
  'release.conf',
  'release.json',
];

function loadReleaseConfig(searchDir) {
  const root = searchDir ? resolve(searchDir) : resolve(__dirname, '../../..');
  for (const name of candidates) {
    const fullPath = resolve(root, name);
    if (existsSync(fullPath)) {
      try {
        const raw = readFileSync(fullPath, 'utf8');
        const parsed = JSON.parse(raw);
        const serverUrl = parsed.server?.url || 'https://storyblueprint.biaozi.biz:8443';
        const feedUrl =
          parsed.server?.feedUrl ||
          (parsed.server?.url ? `${parsed.server.url.replace(/\/+$/, '')}/updates` : 'https://storyblueprint.biaozi.biz:8443/updates');

        const resolved = {
          portal: {
            port: parsed.portal?.port ?? 8443,
            host: parsed.portal?.host ?? '0.0.0.0',
          },
          server: {
            url: serverUrl,
            feedUrl,
          },
          release: {
            channel: parsed.release?.channel ?? 'stable',
            keyId: parsed.release?.keyId ?? 'release-2026',
            privateKeyFile: parsed.release?.privateKeyFile ?? '.release-keys/release-2026.pem',
          },
        };

        return { config: resolved, raw: parsed, filePath: fullPath };
      } catch (err) {
        console.warn(`[release-config] Warning: Failed to parse ${fullPath}:`, err.message);
      }
    }
  }

  return {
    config: {
      portal: { port: 8443, host: '0.0.0.0' },
      server: {
        url: 'https://storyblueprint.biaozi.biz:8443',
        feedUrl: 'https://storyblueprint.biaozi.biz:8443/updates',
      },
      release: {
        channel: 'stable',
        keyId: 'release-2026',
        privateKeyFile: '.release-keys/release-2026.pem',
      },
    },
    raw: {},
    filePath: null,
  };
}

module.exports = {
  loadReleaseConfig,
};
