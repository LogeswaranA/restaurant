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
    },
  },
});
