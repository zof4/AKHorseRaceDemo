import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = process.env.API_PORT ?? '3001';
const apiTarget = process.env.API_TARGET ?? `http://localhost:${apiPort}`;

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': apiTarget,
      '/socket.io': {
        target: apiTarget,
        ws: true
      }
    }
  }
});
