import { defineConfig } from 'vite';

// Relative base so the built game works from any path (root domain,
// subfolder, or static hosts) without rebuilds.
export default defineConfig({
  base: './',
  server: {
    // During `npm run dev`, forward same-origin multiplayer/health traffic to
    // the Worker running under `npm run dev:worker` (wrangler dev on :8787),
    // so the client can always use the same-origin /ws/public endpoint.
    proxy: {
      '/ws': {
        target: 'ws://localhost:8787',
        ws: true,
      },
      '/health': 'http://localhost:8787',
    },
  },
});
