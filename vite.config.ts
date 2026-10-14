import { defineConfig } from 'vite';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

// Every dev/*.html page is a standalone harness (crab turntable, motion viewer, world fly-through...).
// `pnpm dev` serves them as they are; a production build leaves them (and their dev/assets) out
// unless CC_DEV_PAGES=1 is set: CC_DEV_PAGES=1 pnpm build.
const withDevPages = process.env.CC_DEV_PAGES === '1';
const devPages = withDevPages
  ? Object.fromEntries(
      readdirSync(resolve(root, 'dev'))
        .filter((f: string) => f.endsWith('.html'))
        .map((f: string) => [`dev-${f.replace(/\.html$/, '')}`, resolve(root, 'dev', f)]),
    )
  : {};

export default defineConfig({
  base: './',
  server: {
    headers: {
      // SharedArrayBuffer for MuJoCo WASM threads and onnxruntime-web.
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: { main: resolve(root, 'index.html'), ...devPages },
    },
  },
});
