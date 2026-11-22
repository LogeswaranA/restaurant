import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// One entry per HTML page.
const pages = {
  main: resolve(import.meta.dirname, 'index.html'),
  about: resolve(import.meta.dirname, 'about.html'),
};

export default defineConfig({
  build: {
    rollupOptions: {
      input: pages,
      // Keep the single-page bundle names (assets/index-<hash>.js) that the tests and docs expect.
      output: {
        entryFileNames: 'assets/index-[hash].js',
        chunkFileNames: 'assets/index-[hash].js',
        assetFileNames: 'assets/index-[hash][extname]',
      },
    },
  },
});
