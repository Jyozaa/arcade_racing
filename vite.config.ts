import { defineConfig } from 'vite';

// Relative base so the built game works from any path (root domain,
// subfolder, or static hosts) without rebuilds.
export default defineConfig({
  base: './',
});
