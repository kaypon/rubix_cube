import { defineConfig } from "vite";

export default defineConfig({
  worker: { format: "es" },
  build: {
    // three.js is most of the bundle (~165 kB gzipped); that's expected.
    chunkSizeWarningLimit: 800,
  },
});
