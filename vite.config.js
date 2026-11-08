import { defineConfig, loadEnv } from 'vite';
import { prunePosterSources } from './scripts/prune-build-sources.mjs';
import { browserSourceDigest } from './scripts/browser-source-digest.mjs';

// Modules bootstrap.js loads in sequence on every page (see the funded-startup-preload plugin).
const STARTUP_MODULES = ['bootstrap.js', 'app.js', 'page-experience.js', 'creator-support-ui.js', 'adoption-ui.js',
  'automatic-rewards-ui.js', 'personal-rewards-ui.js', 'workspace-ui.js', 'reward-experience-ui.js',
  'retention-ux.js', 'product-measurement.js', 'product-experience.js'];

export function browserBuildSettings(fileEnv = {}, runtimeEnv = process.env) {
  const env = { ...fileEnv, ...runtimeEnv };
  const enabled = name => String(env[name] || '').toLowerCase() === 'true';
  const cluster = String(env.VITE_SOLANA_CLUSTER || 'devnet').trim();
  const exploreCluster = String(env.VITE_EXPLORE_CLUSTER || cluster).trim();
  if (!['devnet', 'mainnet-beta'].includes(cluster) || exploreCluster !== cluster) throw new Error('Build requires matching supported application and Explore networks.');
  if (cluster === 'mainnet-beta' && enabled('VITE_MAINNET_READ_ONLY') && enabled('VITE_ALLOW_MAINNET')) throw new Error('Read-only staging cannot enable Mainnet writes.');
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
    '^/devnet-metadata/': { target: apiTarget, changeOrigin: false },
    '/devnet-images': { target: apiTarget, changeOrigin: false },
    '/devnet-banners': { target: apiTarget, changeOrigin: false },
  } : undefined;
  return {
    cacheDir: process.env.VITE_CACHE_DIR || undefined,
    plugins: [{ name: 'funded-build-settings',
      transformIndexHtml(html) {
        if (!mainnetReadOnly) return html;
        return html.replaceAll('Solana Devnet uses test SOL with no monetary value.', 'Solana Mainnet preview: transactions are disabled.')
          .replaceAll('Devnet · test SOL</span>', 'Mainnet · read only</span>');
      },
      configResolved(config) { resolvedOutput = { root: config.root, outDir: config.build.outDir }; },
      async buildStart() { sourceDigest = await browserSourceDigest(resolvedOutput.root); },
      async generateBundle() {
        if (sourceDigest !== await browserSourceDigest(resolvedOutput.root)) throw new Error('Browser source changed during build. Build again from a stable checkout.');
        this.emitFile({ type: 'asset', fileName: 'build-settings.json', source: JSON.stringify({ ...settings, sourceDigest }, null, 2) + '\n' });
      }
    }, { name: 'funded-artwork-delivery', apply: 'build',
      async closeBundle() { const report = await prunePosterSources(resolvedOutput); console.log(`Omitted ${report.omittedFiles} unused poster source PNGs (${report.omittedBytes} bytes) from release output.`); }
    }, { name: 'funded-startup-preload', apply: 'build',
      // bootstrap.js imports its startup modules one after another so they run in order.
      // Preloading them (and their imports) lets the browser download them in parallel
      // from the first byte; modulepreload fetches without running, so order is unchanged.
      transformIndexHtml: { order: 'post', handler(html, ctx) {
        const slash = value => String(value || '').split(String.fromCharCode(92)).join('/');
        if (!ctx.bundle || !slash(ctx.filename).endsWith('/index.html')) return html;
        const chunks = Object.values(ctx.bundle).filter(item => item.type === 'chunk');
        const byFile = new Map(chunks.map(chunk => [chunk.fileName, chunk]));
        const root = slash(resolvedOutput.root);
        const files = new Set();
        const visit = file => { const chunk = byFile.get(file); if (!chunk || files.has(file)) return; files.add(file); chunk.imports.forEach(visit); };
        for (const chunk of chunks) {
          const source = slash(chunk.facadeModuleId);
          if (source && STARTUP_MODULES.some(name => source === `${root}/${name}`)) visit(chunk.fileName);
        }
        const tags = [...files].filter(file => !html.includes(file)).map(file => `    <link rel="modulepreload" crossorigin href="/${file}">`);
        return tags.length ? html.replace('</head>', `${tags.join('\n')}\n  </head>`) : html;
      } }
    }],
    optimizeDeps: { entries: ['index.html'] },
    server: {
      // Trace HTML and generated evidence must not reload an active app or test page.
      // Sibling worktrees, build output and audit dumps are not app source; watching them stalls startup.
      watch: { ignored:['**/tmp/**', '**/test-results/**', '**/playwright-report/**', '**/.worktrees/**', '**/.tmp-*/**', '**/dist/**', '**/dist-mainnet-readonly/**', '**/audit-records/**', '**/.secrets/**', '**/contracts/**', '**/data/**'] },
      // Keep the browser Host so OAuth callback inference and exact-origin POST checks
      // use the Vite origin that owns the session cookie.
      proxy: apiProxy,
    },
    preview: { proxy: apiProxy },
    build: {
      rolldownOptions: {
        preserveEntrySignatures: 'allow-extension',
        input: { main:'index.html', admin:'admin.html', welcome:'welcome.html' },
        output: {
          strictExecutionOrder: true,
          codeSplitting: { includeDependenciesRecursively: false, groups: [{ name(id) {
            if (!id.includes('node_modules')) return undefined;
            // The browser entry installs Buffer before importing the Solana SDK.
            // Keep its implementation outside the SDK chunk so importing Buffer
            // cannot evaluate SDK module code first.
            if (id.replaceAll('\\', '/').includes('/node_modules/buffer/')) return 'buffer-polyfill';
            if (id.includes('@pump-fun/pump-swap-sdk')) return 'pump-swap-sdk';
            if (id.includes('@pump-fun/pump-sdk')) return 'pump-sdk';
            if (id.includes('@solana/spl-token')) return 'solana-spl-token';
            if (id.includes('@solana/web3.js')) return 'solana-web3';
            return undefined;
          } }] },
        },
      },
    },
  };
});
