import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

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
