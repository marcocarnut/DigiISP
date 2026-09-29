import { defineConfig } from 'vite';

// Relative base so the build works from any static host path (e.g. GitHub Pages).
// The app bundles firmware hex files from ../firmware. wiring.html is the
// wiring diagram spike.
export default defineConfig({
  base: './',
  server: { fs: { allow: ['..'] } },
  build: {
    rollupOptions: {
      input: { main: 'index.html', wiring: 'wiring.html' },
    },
  },
});
