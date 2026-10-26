import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

// Dev-only middleware: serve the goinfra installers at the SAME URL shape used
// in production (/downloads/goinfra/install.sh|ps1), reading them straight from
// scripts/downloads/ on disk. If the backend proxy is up it wins first; this is
// the fallback so copy-pasted install commands work even without uvicorn running.
const serveGoinfraInstallers = {
  name: 'serve-goinfra-installers',
  configureServer(server: import('vite').ViteDevServer) {
    server.middlewares.use((req, res, next) => {
      const m = /^\/downloads\/goinfra\/(install\.(?:sh|ps1))$/.exec(req.url || '');
      if (!m) return next();
      const file = path.resolve(projectRoot, 'scripts/downloads', m[1]);
      if (!fs.existsSync(file)) return next();
      res.setHeader(
        'Content-Type',
        m[1].endsWith('.ps1') ? 'text/plain; charset=utf-8' : 'text/x-sh; charset=utf-8',
      );
      fs.createReadStream(file).pipe(res);
    });
  },
};

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
  // goinfra agent binaries + installers are served by the backend's static
  // mount (/downloads) so dev/preview URLs match production one-liners.
  '/downloads': {
    target: process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8000',
    changeOrigin: true,
  },
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), serveGoinfraInstallers],
  base: './',
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1600,
  },
  server: {
    port: 5173,
    host: true, // reachable from LAN on Kali & Windows for testing
    proxy: apiProxy,
    watch: {
      // Windows fix: the goinfra installer sources live in scripts/downloads/.
      // Vite's dev-server FSWatcher recurses into every non-ignored folder and
      // crashes the whole process with "UNKNOWN: unknown error, lstat ...install.ps1"
      // (errno -4094) when it hits that dir — typically because OneDrive/AV/
      // path-with-spaces ("workspace (23)") locks or reparse-points the files.
      // The served copies are in public/downloads/, so watching scripts/ is
      // pointless; ignore it to keep `npm run dev` stable.
      ignored: ['**/scripts/**', '**/backend/**', '**/agent-go/**'],
    },
  },
  preview: {
    port: 4173,
    proxy: apiProxy, // same backend routing when serving the production build
  },
});
