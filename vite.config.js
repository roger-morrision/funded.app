import { defineConfig } from 'vite';

const apiTarget = String(process.env.API_PROXY_TARGET || '').trim();

export default defineConfig({
  server: {
    proxy: apiTarget ? { '/api': { target: apiTarget, changeOrigin: true } } : undefined,
  },
});
