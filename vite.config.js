import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const mainnetReadOnly = process.env.VITE_SOLANA_CLUSTER === 'mainnet-beta' && process.env.VITE_MAINNET_READ_ONLY === 'true';
  const apiTarget = String(process.env.API_PROXY_TARGET || env.API_PROXY_TARGET || '').trim();
  const apiProxy = apiTarget && !mainnetReadOnly ? {
    '/api': { target: apiTarget, changeOrigin: false },
    '/devnet-images': { target: apiTarget, changeOrigin: false },
  } : undefined;
  return {
    optimizeDeps: { entries: ['index.html'] },
    server: {
      // Keep the browser Host so OAuth callback inference and exact-origin POST checks
      // use the Vite origin that owns the session cookie.
      proxy: apiProxy,
    },
    preview: { proxy: apiProxy },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('@pump-fun/pump-swap-sdk')) return 'pump-swap-sdk';
            if (id.includes('@pump-fun/pump-sdk')) return 'pump-sdk';
            if (id.includes('@solana/spl-token')) return 'solana-spl-token';
            if (id.includes('@solana/web3.js')) return 'solana-web3';
            return undefined;
          },
        },
      },
    },
  };
});
