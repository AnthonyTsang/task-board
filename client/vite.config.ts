import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Same-origin in development, so the server needs no CORS middleware.
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true } },
  },
});
