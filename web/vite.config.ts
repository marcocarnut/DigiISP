import { defineConfig } from 'vite';

// Relative base so the build works from any static host path (e.g. GitHub Pages).
// The app bundles firmware hex files from ../firmware.
export default defineConfig({
  base: './',
  server: { fs: { allow: ['..'] } },
});
