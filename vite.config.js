import { defineConfig } from 'vite';
import { readdirSync, copyFileSync, mkdirSync, cpSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

// Keep non-bundled legacy assets available to static pages and server-rendered storefront HTML.
function preserveLegacyAssets() {
  return {
    name: 'preserve-legacy-assets',
    closeBundle() {
      const out = resolve(root, 'dist');
      mkdirSync(out, { recursive: true });
      for (const name of readdirSync(root)) {
        if (!/\.(?:js|css|svg|webmanifest)$/i.test(name) || name === 'mcp-server.js') continue;
        copyFileSync(resolve(root, name), resolve(out, name));
      }
    }
  };
}

export default defineConfig({
  publicDir: false,
  plugins: [preserveLegacyAssets()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        home: resolve(root, 'index.html'),
        dashboard: resolve(root, 'dashboard.html'),
        legal: resolve(root, 'legal.html'),
        support: resolve(root, 'support.html'),
        mcpLogin: resolve(root, 'mcp-login.html'),
        mcpConsent: resolve(root, 'mcp-consent.html'),
        premiumThankYou: resolve(root, 'premium-thank-you.html'),
        stockKeeper: resolve(root, 'staff-modes/stock-keeper.html')
      }
    }
  }
});
