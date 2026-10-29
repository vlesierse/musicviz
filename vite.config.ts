import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base works both on GitHub Pages (/musicviz/) and locally.
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
});
