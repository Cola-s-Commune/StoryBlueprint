import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

function getReleaseConfig() {
  const candidates = ['release.config.json', 'release.conf.json', 'release.conf'];
  const root = resolve(__dirname, '../..');
  for (const name of candidates) {
    const full = resolve(root, name);
    if (existsSync(full)) {
      try {
        const raw = JSON.parse(readFileSync(full, 'utf8'));
        const serverUrl = process.env.STORY_BLUEPRINT_SERVER_URL || raw.server?.url || 'https://storyblueprint.biaozi.biz:8443';
        const feedUrl =
          process.env.STORY_BLUEPRINT_FEED_URL ||
          raw.server?.feedUrl ||
          (raw.server?.url ? `${raw.server.url.replace(/\/+$/, '')}/updates` : 'https://storyblueprint.biaozi.biz:8443/updates');
        return { serverUrl, feedUrl };
      } catch {}
    }
  }
  const serverUrl = process.env.STORY_BLUEPRINT_SERVER_URL || 'https://storyblueprint.biaozi.biz:8443';
  const feedUrl = process.env.STORY_BLUEPRINT_FEED_URL || `${serverUrl.replace(/\/+$/, '')}/updates`;
  return { serverUrl, feedUrl };
}

const { serverUrl, feedUrl } = getReleaseConfig();

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          '@story-blueprint/common',
          '@story-blueprint/compiler',
          '@story-blueprint/runtime',
        ],
      }),
    ],
    define: {
      __OFFICIAL_FEED_URL__: JSON.stringify(feedUrl),
      __OFFICIAL_SERVER_URL__: JSON.stringify(serverUrl),
    },
    build: {
      outDir: '.output/main',
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: '.output/preload',
    },
  },
  renderer: {
    plugins: [react()],
    root: 'src/renderer',
    define: {
      __OFFICIAL_FEED_URL__: JSON.stringify(feedUrl),
      __OFFICIAL_SERVER_URL__: JSON.stringify(serverUrl),
    },
    build: {
      outDir: '.output/renderer',
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer'),
        '@story-blueprint/common': resolve(__dirname, '../common/src/index.ts'),
        '@story-blueprint/compiler': resolve(__dirname, '../compiler/src/index.ts'),
        '@story-blueprint/runtime': resolve(__dirname, '../runtime/src/index.ts'),
      },
    },
  },
});

