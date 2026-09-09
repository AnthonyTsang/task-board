import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// No `server.proxy`: Vite runs in middleware mode inside the Express server
// (see server/src/client.ts), so the client and the API are already one origin
// and there is nothing to proxy to. The client fetches relative /api paths.
export default defineConfig({
  plugins: [react(), tailwindcss()],
});
