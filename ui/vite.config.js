import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

/**
 * Inline every emitted JS chunk and CSS asset into index.html so the build
 * output is ONE self-contained file (the server embeds it as a string).
 */
function inlineSingleFile() {
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return {
    name: 'mdctl:inline-single-file',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const htmlAsset = Object.values(bundle).find(
        (a) => a.type === 'asset' && a.fileName.endsWith('.html')
      );
      if (!htmlAsset) return;
      let html =
        typeof htmlAsset.source === 'string'
          ? htmlAsset.source
          : new TextDecoder().decode(htmlAsset.source);

      for (const [name, item] of Object.entries(bundle)) {
        if (item === htmlAsset) continue;
        const ref = new RegExp(`(?:\\.?\\/)?${escapeRe(name)}`);
        if (item.type === 'chunk') {
          const code = item.code.replace(/<\/script/gi, '<\\/script');
          const tag = new RegExp(`<script[^>]*src="${ref.source}"[^>]*><\\/script>`);
          if (tag.test(html)) {
            html = html.replace(tag, () => `<script type="module">\n${code}\n</script>`);
          } else {
            html = html.replace('</body>', () => `<script type="module">\n${code}\n</script>\n</body>`);
          }
          delete bundle[name];
        } else if (name.endsWith('.css')) {
          const css = String(item.source).replace(/<\/style/gi, '<\\/style');
          const tag = new RegExp(`<link[^>]*href="${ref.source}"[^>]*>`);
          if (tag.test(html)) html = html.replace(tag, () => `<style>\n${css}\n</style>`);
          else html = html.replace('</head>', () => `<style>\n${css}\n</style>\n</head>`);
          delete bundle[name];
        } else if (name.endsWith('.map')) {
          delete bundle[name];
        }
      }
      // drop any leftover modulepreload hints
      html = html.replace(/<link rel="modulepreload"[^>]*>\s*/g, '');
      htmlAsset.source = html;
    },
  };
}

export default defineConfig({
  root,
  base: './',
  plugins: [svelte(), inlineSingleFile()],
  server: {
    // during `vite dev` proxy the API to a locally running mdctl server;
    // if it isn't running, /api/state fails and the UI falls back to the mock.
    proxy: { '/api': { target: 'http://127.0.0.1:4747', changeOrigin: true } },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    modulePreload: { polyfill: false },
    sourcemap: false,
    reportCompressedSize: true,
    chunkSizeWarningLimit: 2000,
  },
});
