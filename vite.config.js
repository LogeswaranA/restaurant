import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Add one entry per HTML page (e.g. about: resolve(import.meta.dirname, 'about.html')).
const pages = {
  main: resolve(import.meta.dirname, 'index.html'),
};

export default defineConfig({
  build: {
    rollupOptions: {
      input: pages,
    },
  },
});
