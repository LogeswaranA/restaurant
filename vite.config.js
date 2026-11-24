import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Every HTML page is a build entry; without this list `vite build` only emits index.html.
// Add new pages here as well. (`rollupOptions` is Vite 8's alias for `rolldownOptions`.)
const page = (file) => fileURLToPath(new URL(file, import.meta.url));

const API_TARGET = `http://127.0.0.1:${process.env.PORT ?? 8787}`;
const apiProxy = { '/api': { target: API_TARGET, changeOrigin: false } };

export default defineConfig({
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
  build: {
    rollupOptions: {
      input: {
        index: page('./index.html'),
        booking: page('./booking.html'),
      },
    },
  },
});
