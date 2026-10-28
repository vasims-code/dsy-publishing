import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// The browser's own interface (tab strip, toolbar, side panel, settings).
// Electron loads the built files from dist/renderer.
export default defineConfig({
  root: fileURLToPath(new URL("./renderer", import.meta.url)),
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@toolkit": fileURLToPath(new URL("../aem-toolkit/src", import.meta.url)),
      "@": fileURLToPath(new URL("./renderer/src", import.meta.url)),
    },
  },
  build: {
    outDir: fileURLToPath(new URL("./dist/renderer", import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
  },
});
