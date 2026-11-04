# Docker and GitHub Codespaces

The workspace deployment runs the production Node 24 application with PostgreSQL 17. It uses the Devnet-only profile, persistent Docker volumes and generated local credentials. Server signing keys, test-wallet signing, mainnet and financial background workers remain disabled. Web health does not certify a complete financial workflow.

## Local browser checks without Docker

Run `npm run test:browser -- <test-file>` for local UI tests. The default
Playwright setup starts Vite through its JavaScript API on `127.0.0.1:4173`
(`PLAYWRIGHT_PORT` overrides the port), pins the frontend to Devnet and turns
off wallet autoconnection. It warms the app before tests and closes that same
server during teardown. An occupied port fails startup; the suite does not
reuse or stop an existing service. No Docker startup is involved.

The setup restores its environment overrides after shutdown and closes the
owned server if warmup fails. Explicit integration configurations with their
own `webServer`, and non-loopback base URLs, retain their existing lifecycle.
API fixtures and mocked wallets verify UI behavior only; they do not establish
live on-chain outcomes.

## Open in GitHub Codespaces

1. Open [the main branch](https://github.com/roger-morrision/funded.app/tree/main), then **Code → Codespaces → Create codespace on this branch**. The repository includes `.devcontainer/devcontainer.json`.
2. Wait for the Docker/Node features and initial image build. Startup creates fresh database/API credentials under ignored `.secrets/workspace-devnet`, applies database migrations and starts the app and database. No external hosting keys are required.
3. In the **Ports** tab, open **8788 — Funded Devnet**. The app uses `https://<codespace-name>-8788.app.github.dev` for its public origin, CORS, mobile callback and new metadata URLs. The forwarded port is private by default.

Private port forwarding requires GitHub login and is suitable for browser testing. Third-party token metadata fetchers and physical-wallet callbacks cannot access a private port. For those tests, use the Ports tab's visibility control to make this disposable Devnet service public, and verify access from a signed-out browser. Existing token metadata URLs do not move when a Codespace changes or is deleted.

GitHub API access to repository contents does not automatically include Codespaces management. If the assistant receives HTTP 403 for Codespaces, create it using the steps above, or grant repository **Codespaces: Read and write** permission in the applicable token/integration. Codespaces is development hosting: account quotas, idle shutdown and billing settings apply. Stop the Codespace when unused. It is not an always-on production host.

## Run on your Docker machine

Requirements: Docker with Compose, Node 24 and Git. Use a clean committed checkout:

```sh
node scripts/workspace-devnet.mjs start
node scripts/workspace-devnet.mjs status
node scripts/workspace-devnet.mjs stop
```

The default app URL is `http://127.0.0.1:8788`. `stop` retains PostgreSQL and application data volumes. Starting again reuses credentials and the exact image when the source revision and origin match. Committing new source triggers a new build. Only the app's loopback port is published; PostgreSQL stays private to its Docker network.

For an existing HTTPS reverse proxy, set `FUNDED_WORKSPACE_ORIGIN` to its exact origin before `start`. Changing the origin rebuilds browser metadata configuration and recreates the app with matching server configuration. Configure the proxy separately; this helper does not provision DNS, HTTPS certificates or a public tunnel.

Credentials are generated once in a directory with mode 0700, excluded from Git and Docker build context, and mounted as individual files. Do not delete them while retaining the database volume: PostgreSQL keeps its original password. Do not run `docker compose down --volumes` unless you intend to delete the stored records. Back up before deleting a Codespace or its Docker storage.

For this managed ChatGPT workspace, the assistant maintains a separate deployment under `/workspace/funded-deployment` with the environment's proxy/CA settings. Its local port is reachable inside that workspace; `127.0.0.1` is not a public link to your computer. Use the GitHub Codespaces option above for a browser-accessible workspace when no preview forwarding is available here.

## Check capacity before upgrading an existing deployment

A previous image built successfully but app recreation failed because the workspace filesystem was full. Before building, run this read-only check against the existing app container; run it again with `--phase switch` after the build and before changing image selectors or recreating the app:

```sh
node scripts/check-deployment-capacity.mjs --container funded-devnet-workspace-app-1 --workspace /workspace/funded.app --phase build
node scripts/check-deployment-capacity.mjs --container funded-devnet-workspace-app-1 --workspace /workspace/funded.app --phase switch
```

The helper checks available bytes and free inodes on the workspace filesystem and the existing container's root filesystem through the explicit local Docker socket. It requires 4 GiB/10,000 inodes before building and 2 GiB/5,000 inodes before replacement. These are conservative operating estimates for this app, not a guarantee that future writes will fit. Separate data volumes, daemon quotas and concurrent writers require their own checks. Both readings must meet the threshold; unavailable measurements fail closed with exit code 1. This is an operator preflight, not an automatic hook in the startup helper, and requires an existing Node application container.

The check creates no container, writes no data and performs no cleanup. If it fails, leave the healthy app and image selectors alone, inspect capacity, and choose an explicit recovery action. Preserve database/application volumes, backups, the current image and its rollback image. Do not turn a capacity failure into an automatic system or volume prune; record any selected cache cleanup and re-run both checks before continuing.

On Windows with Docker Desktop's Linux engine, the capacity and image verifiers use its explicit local named pipe. Windows workspace inode counters are unsupported and returned as zero by libuv, so the workspace check requires the byte reserve only. The Linux application container still has to meet both byte and inode thresholds; unavailable readings still fail closed. See [libuv filesystem statistics](https://docs.libuv.org/en/v1.x/fs.html).

## Verify the image before deployment

The Docker build normalizes application permissions after building and pruning development dependencies, before copying files into the runtime image. Keep this normalization: source archives can contain files readable only by their original owner. Application files remain owned by root and readable by the non-root Node user; only the data directory needs application ownership. Repeating recursive permission changes after the runtime copy adds another image layer containing copied-up files.

The `docker-image` CI job builds the exact source revision on a disposable runner and starts the Devnet release profile with its own PostgreSQL database and generated test credentials. Image checks cover non-root access, executable dependencies, writable data, read-only source, safe browser settings and matching source identity. HTTP and browser checks exercise the actual built assets. These checks do not establish public hosting, real wallet acceptance or on-chain settlement, and do not deploy the image to the workspace preview.

For an already running, explicitly selected local Devnet container, set `FUNDED_EXPECT_BUILD` to the full source revision before running `node scripts/verify-container-image.mjs <container>`. Optionally set `FUNDED_EXPECT_IMAGE` to its immutable image ID. The verifier checks image labels and runtime identity, performs one uniquely named data-directory write, and removes that probe immediately. It never submits a transaction or starts an X worker.

Keep image-layer sizes separate from physical disk usage. Moving permissions earlier can reduce a runtime layer without reclaiming existing images or proving a lower peak build-space requirement. Do not reduce the capacity thresholds from image history alone. A local capacity failure can leave the running preview on an older revision even when source and CI are current; report both identities explicitly.

## Verify app and worker release readiness

For the existing funded.vip Devnet stack, deploy `app`, `fee-collector`, `buyback-worker` and `agency-buyback-worker` from the same immutable image with the same `FUNDED_BUILD_ID` and revision label. An app-only update can leave the agency worker publishing the previous build; the launch readiness gate correctly refuses new launches in that state. Include worker alignment in the release operation, even for frontend-only changes that replace the app image.

After the workers complete startup verification, run `node scripts/verify-deployment-readiness.mjs fundedapp <full-tested-commit> https://funded.vip`. This read-only check requires matching images and revisions, Devnet configuration, running services, healthy configured health checks, the expected public API build and a ready developer escrow launch gate. Workers without Docker health checks are reported as `not-configured`, never as healthy. A failed check means deployment acceptance is incomplete; do not weaken the on-chain readiness gate to make it pass. It does not prove trades or payouts.

## Release the existing funded.vip stack as one unit

Use `npm run release:devnet -- ...` for an existing, explicitly selected Devnet stack. This host-side helper replaces the app and all three financial workers together. It never starts Docker Desktop, starts infrastructure dependencies, builds/pulls images, prunes storage, or reverses database migrations. Keep Docker stopped when only preparing or checking a bundle.

Prepare a release from **resolved Compose JSON** (`docker compose ... config --format json` using the current stack's exact configuration files), an already built immutable image ID, its full source revision, and the HTTPS origin:

```sh
npm run release:devnet -- prepare /private/resolved-compose.json sha256:<64-hex-image-id> <40-hex-revision> https://funded.vip
npm run release:devnet -- check <returned-release-id>
```

Preparation works with Docker stopped. It stores private release bundles under `.secrets/funded-vip-deployment/releases/`, outside `tmp/` and excluded from Git and Docker build context. Treat the resolved Compose input as private: environment values can contain credentials. Preparation freezes all read-only host mounts (including the reviewed `/app/dist` frontend and existing configuration overrides) and Compose config files, recording checksums and the exact input inventory. Secret files remain references to stable absolute paths so credential rotation is not rolled back. Existing volume and network names become external references; writable host binds, temporary secret paths, unresolved inheritance and missing Devnet workers are rejected.

For each new release, the resolved input must point at that release's reviewed frontend. Existing runtime overrides remain part of the bundle; they are not silently discarded or claimed to be part of the base image. Build the frontend and image from the same reviewed source. Deployment compares the image's revision and embedded frontend digest against the bundle before replacement. The image filesystem is inspected through a temporary container that is **never started**, receives no credentials, and is removed afterward.

Once Docker and the existing infrastructure are deliberately running and the source/image have passed their required tests:

```sh
npm run release:devnet -- deploy <release-id>
npm run release:devnet -- verify <release-id>
npm run release:devnet -- rollback
```

`deploy` checks the immutable image, existing dependencies, switch-time capacity and bundle checksums. It calls Compose once for `app`, `fee-collector`, `buyback-worker` and `agency-buyback-worker`, with no dependency startup, build or pull. Acceptance requires every service to run the prepared image/revision on Devnet, configured Docker health checks to pass, and public API/frontend identity, 1% trading fees and the ready 12-hour escrow gate to match. A worker without a Docker health check is explicitly reported as `not-configured`; public launch readiness is still required. These checks do not establish new on-chain transaction outcomes.

Only successful acceptance changes `state.json`. A failed or interrupted replacement retains `pending.json` and the previous accepted release. Retry that same bundle or use `rollback`; a different candidate is refused while recovery is unresolved. Rollback can restore the previous accepted bundle even when the current app is unhealthy, then repeats the same verification. **The first deployment has no verified rollback target**: do not describe an imported, untested configuration as a verified backup. Later rollback also requires the prior image to remain available and the database schema to remain compatible; it does not undo financial transactions or database writes. Retain both current and previous bundles/images during cleanup.

A filesystem lock prevents overlapping releases. If the host process was killed, inspect the pending journal and running containers before manually removing a stale `release.lock`. Do not edit bundle files to repair a failed release; prepare a new bundle after resolving the interrupted operation. CLI errors omit raw Docker/Compose output because it may contain credentials.

## Clean local staging files

`tmp/` is excluded from Git, but an existing deployment can still depend on files there. Before removing old staging files, inspect the app container's `com.docker.compose.project.config_files` label, render that exact Compose chain, and check its build context and bind mounts. Preserve every referenced configuration file, the current build source, deployment and rollback tools, and recovery backups.

Archive retired files under ignored `.secrets/` storage and verify their hashes before deleting the originals. Handle directory junctions and symbolic links separately so cleanup cannot traverse their targets. After cleanup, verify that the resolved Compose configuration and retained files are unchanged and that running container identities and start times match the pre-cleanup snapshot. Local file cleanup requires no service restart or volume removal.

Commit documentation changes separately from ignored staging files and private archives. Recover retired tracked reports from Git history; retain local recovery archives for files that were never tracked.
