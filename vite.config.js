import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readFileSync } from 'node:fs';

// Builds ONE self-contained file, dist/index.html (no CDN, works offline), which the server serves at /.
// `npm run dev` serves the page with hot reload and passes the data requests to a running server.
const SERVER = process.env.YARGDASH_URL || 'http://localhost:8900';
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)));

export default defineConfig({
  plugins: [vue(), viteSingleFile()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: { outDir: 'dist', emptyOutDir: true },
  server: { host: true, proxy: Object.fromEntries(['/events', '/status', '/config', '/restart', '/yarg'].map((p) => [p, SERVER])) },
});
