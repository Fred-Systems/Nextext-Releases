import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  base: './',
  build: {
    target: 'es2015',
  },
  // The Android WebView (Chrome 83) can only load a classic IIFE script, so the
  // client SPA MUST be bundled as `iife`. Scope this to the `client` environment
  // ONLY — applying it globally also forced the Cloudflare Worker build into an
  // IIFE, which stripped its `export default { fetch }` handler and caused
  // deploy error 10021 ("No event handlers were registered").
  environments: {
    client: {
      build: {
        rollupOptions: {
          output: {
            format: 'iife',
            entryFileNames: 'assets/[name]-[hash].js',
          },
        },
      },
    },
  },
  plugins: [react(), {
    name: 'strip-crossorigin',
    transformIndexHtml(html) {
      return html.replace(/ crossorigin/g, '')
    },
  }, {
    name: 'convert-module-to-classic',
    transformIndexHtml(html) {
      // Only strip `type="module"` in the production build (the Android
      // WebView needs a classic IIFE script). In `npm run dev` we MUST keep
      // `type="module"` or the React entry throws "Cannot use import statement
      // outside a module" and nothing renders.
      if (process.env.NODE_ENV !== 'production') return html;
      return html.replace(
        /<script type="module" src="([^"]+)"><\/script>/,
        '<script defer src="$1"></script>'
      );
    },
  }, cloudflare()],
})