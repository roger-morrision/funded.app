import { defineConfig, loadEnv } from 'vite';
import { prunePosterSources } from './scripts/prune-build-sources.mjs';
import { browserSourceDigest } from './scripts/browser-source-digest.mjs';

export function browserBuildSettings(fileEnv = {}, runtimeEnv = process.env) {
  const env = { ...fileEnv, ...runtimeEnv };
  const enabled = name => String(env[name] || '').toLowerCase() === 'true';
  const cluster = String(env.VITE_SOLANA_CLUSTER || 'devnet').trim();
  const exploreCluster = String(env.VITE_EXPLORE_CLUSTER || cluster).trim();
  if (!['devnet', 'mainnet-beta'].includes(cluster) || exploreCluster !== cluster) throw new Error('Build requires matching supported application and Explore networks.');
  return { schemaVersion: 1, cluster, exploreCluster, mainnetEnabled: enabled('VITE_ALLOW_MAINNET'),
    mainnetReadOnly: cluster === 'mainnet-beta' && enabled('VITE_MAINNET_READ_ONLY'),
    devWalletEnabled: cluster === 'devnet' && enabled('VITE_DEV_MODE') };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const settings = browserBuildSettings(env);
  const mainnetReadOnly = settings.mainnetReadOnly;
  let resolvedOutput;
  let sourceDigest;
  const apiTarget = String(process.env.API_PROXY_TARGET || env.API_PROXY_TARGET || '').trim();
  const apiProxy = apiTarget && !mainnetReadOnly ? {
    '/api': { target: apiTarget, changeOrigin: false },
    '/devnet-images': { target: apiTarget, changeOrigin: false },
  } : undefined;
  return {
    plugins: [{ name: 'funded-build-settings',
      configResolved(config) { resolvedOutput = { root: config.root, outDir: config.build.outDir }; },
      async buildStart() { sourceDigest = await browserSourceDigest(resolvedOutput.root); },
      async generateBundle() {
        if (sourceDigest !== await browserSourceDigest(resolvedOutput.root)) throw new Error('Browser source changed during build. Build again from a stable checkout.');
        this.emitFile({ type: 'asset', fileName: 'build-settings.json', source: JSON.stringify({ ...settings, sourceDigest }, null, 2) + '\n' });
      }
    }, { name: 'funded-artwork-delivery', apply: 'build',
      async closeBundle() { const report = await prunePosterSources(resolvedOutput); console.log(`Omitted ${report.omittedFiles} unused poster source PNGs (${report.omittedBytes} bytes) from release output.`); }
    }],
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
