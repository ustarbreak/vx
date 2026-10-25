import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The /api proxy lives in ONE place and is applied to BOTH the dev server
// (`npm run dev`, port 5173) and the preview server (`npm run preview`,
// default port 4173). Before, it was only configured under `server:`, so
// running the built app via preview produced endless
// "[vite] http proxy error: ECONNREFUSED" — the browser called /api/* on
// :4173 where nothing was listening.
const apiProxy = {
  '/api': {
    // IMPORTANT (Windows): always target 127.0.0.1, never "localhost".
    // On Windows localhost can resolve to IPv6 ::1 first; if uvicorn/FastAPI
    // is bound to IPv4 only, every proxied connection fails with
    // ECONNREFUSED (Node reports it as an AggregateError because it tries
    // both A/AAAA addresses). 127.0.0.1 removes that ambiguity on Kali too.
    target: process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8000',
    changeOrigin: true,
  },
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1600,
  },
  server: {
    port: 5173,
    host: true, // reachable from LAN on Kali & Windows for testing
    proxy: apiProxy,
  },
  preview: {
    port: 4173,
    proxy: apiProxy, // same backend routing when serving the production build
  },
});
