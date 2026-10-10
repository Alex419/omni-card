import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development, Vite serves the client on :5173 and forwards API and WebSocket traffic to the
// game server on :8787, so the browser sees one origin, exactly like production.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
  build: { sourcemap: true },
});
