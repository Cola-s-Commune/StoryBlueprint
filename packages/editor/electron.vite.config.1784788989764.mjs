// electron.vite.config.ts
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
var __electron_vite_injected_dirname = "D:\\Projects\\StoryBlueprint\\packages\\editor";
var electron_vite_config_default = defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/main"
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/preload"
    }
  },
  renderer: {
    plugins: [react()],
    root: "src/renderer",
    build: {
      outDir: "out/renderer"
    },
    resolve: {
      alias: {
        "@": resolve(__electron_vite_injected_dirname, "src/renderer")
      }
    }
  }
});
export {
  electron_vite_config_default as default
};
