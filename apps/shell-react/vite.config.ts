import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: '0.0.0.0',
    proxy: {
      '/api/agent': { target: process.env.AGENT_PROXY_URL || 'http://127.0.0.1:4300', changeOrigin: false },
    },
  },
});
