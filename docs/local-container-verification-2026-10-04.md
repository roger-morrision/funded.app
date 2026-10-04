# Local release container verification — 2026-10-04

This is a local Docker/Devnet verification, not a deployment to funded.vip. The public origin's Cloudflare tunnel outage requires access to its hosting account. No hosting identity or production credential is configured in the managed environment. No financial transaction or authority change was made by this verification.

## Concrete startup fixes

- BuildKit can mount the managed proxy CA as the optional `proxy_ca` secret during `npm ci`; strict TLS remains enabled. The CA is not copied into an image layer. Dependency pruning is offline and omits development tools.
- The image normalizes source readability for its non-root runtime. A real first startup exposed that local source files with mode `0600` and directories `0700` became root-owned during Docker `COPY`, preventing the Node user from reading the migration/API. The corrected image starts successfully.
- `/app/data` is owned by the Node user so an initialized named data volume remains writable. Application source stays root-owned and the release profile mounts the root filesystem read-only.
- `RENDER_GIT_COMMIT` can supply the build revision when `FUNDED_SOURCE_REVISION` is not explicitly supplied. These are source labels; a clean canonical checkout and verified artifact digests are still required for a release.
- Browser test output and local deployment staging are excluded from the image context.

## Safe standalone Devnet profile

`compose.devnet-release.yml` starts private PostgreSQL 17 and the application image, with the API exposed only on `127.0.0.1:8788` by default. It requires explicit image/build identities, public origin and secret-file paths. It mounts database/API/RPC credentials only. Financial signing keys, faucet forwarding, test-wallet signing, test attestations, buyback execution, boost checkout and payout executors are disabled.

Set these selectors through the host's deployment configuration:

- `FUNDED_APP_IMAGE`: tested image digest; `FUNDED_BUILD_ID`: its source revision.
- `FUNDED_PUBLIC_APP_URL`: the intended HTTPS origin.
- `FUNDED_DB_PASSWORD_FILE`: PostgreSQL password file.
- `FUNDED_DATABASE_URL_FILE`: matching private `postgresql://funded:…@db:5432/funded_app` URL file.
- `FUNDED_API_TOKEN_FILE`: independent random API authentication token file.
- `FUNDED_DEVNET_RPC_URL_FILE`: intended Devnet RPC URL file.
- `FUNDED_DEVNET_METADATA_ORIGIN`: metadata origin matching the image build. It defaults to the legacy `https://metadata.funded.vip`; for a new host, build with `--build-arg VITE_DEVNET_METADATA_ORIGIN=https://your-app.example` and set this variable to that exact origin. The Docker image also carries the matching default runtime origin. Rebuild when changing browser metadata origins.

Keep host secret directories private, while ensuring the mounted files are readable by application UID 1000. Docker Compose file-backed secrets preserve host file modes; do not assume Compose's secret UID mapping makes a root-only `0600` file readable by Node. Use a secret manager or appropriate group/mount permissions. Configure an authenticated TLS reverse proxy in front of the loopback port when hosting remotely. The profile deliberately does not enable signing merely because a web server is healthy.

The API applies migrations before listening. Healthchecks gate startup; `init: true`, dropped capabilities, `no-new-privileges`, a read-only root and a writable data volume constrain the runtime. The application and optional workers must consume the same tested image digest.

## Observed local evidence

The tested candidate image was `sha256:e26e279d3b32169056a4f042f8cb3acb7d9965f2e2201028243bc6c2b962400a`, labeled `local-container-verification`. It was built with Node 24 on base image digest `sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6`. It is a development candidate, not the final canonical release artifact.

Two production-mode application replicas shared a fresh disposable PostgreSQL 17 database. Both became healthy, returned build identity `local-container-verification`, and reported operational database access and the expected public Devnet genesis hash through `/api/status`. The endpoint continued to report `settlementVerified: false` and `mainnetActivationAuthorized: false`.

`node scripts/verify-container-image.mjs <container>` passed UID 1000, source readability, a reversible data-volume write, read-only root, development-dependency pruning, absence of the build-only CA and equality between the image's browser source digest and its built settings. Browser settings were Devnet with mainnet and server-held test wallets disabled.

`verify-release-contract.mjs` passed PostgreSQL-backed release identity, six built assets, deep links, the wallet-signed chat API contract and 20 concurrent read requests. The observed concurrency smoke completed in 76 ms; it is not a load-capacity benchmark. The E2E agent separately exercised actual signed HTTP chat across both replicas without request interception.

After later source or deployment-helper edits, build a new image and repeat these checks. Never relabel this candidate as the final commit's image. Keep finalized financial journeys, real identity-provider integration, mobile wallet handoff, public ingress recovery and independent contract review as separate acceptance evidence.

Additional actual-container acceptance passed against the two replicas: concurrent signed challenge verification admitted exactly one request (200/401), the session worked across replicas, wrong-wallet use returned 401, and authenticated posts/deletion/revocation persisted in PostgreSQL. Six unmocked Chromium checks covered Explore, Launch and Docs at desktop/mobile sizes, real API/status responses and absence of uncaught browser errors or horizontal overflow. Restarting only the primary application preserved both an existing session and a pending one-use challenge; replay was rejected afterward. These checks used disposable wallets and sent no chain transactions. Repeat against the final image after the final source commit; final image evidence is stored outside the repository to avoid recursively changing the source it identifies.
