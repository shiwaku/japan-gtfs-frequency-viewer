import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages のプロジェクトページ用: 環境変数 VITE_BASE_PATH で上書き可能
  // 例: VITE_BASE_PATH=/japan-gtfs-frequency-viewer/
  base: process.env.VITE_BASE_PATH ?? "/",
  server: {
    port: 5173,
  },
  build: {
    outDir: "dist",
  },
});
