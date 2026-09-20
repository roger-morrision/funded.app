import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = String(env.API_PROXY_TARGET || '').trim();
  return {
    server: {
      proxy: apiTarget ? { '/api': { target: apiTarget, changeOrigin: true } } : undefined,
    },
  };
});
