# Docker and GitHub Codespaces

The workspace deployment runs the production Node 24 application with PostgreSQL 17. It uses the Devnet-only profile, persistent Docker volumes and generated local credentials. Server signing keys, test-wallet signing, mainnet and financial background workers remain disabled. Web health does not certify a complete financial workflow.

## Open in GitHub Codespaces

1. Open [the enhancement branch](https://github.com/roger-morrision/funded.app/tree/enhancements/devnet-readiness-2026-10-04), then **Code → Codespaces → Create codespace on this branch**. The repository includes `.devcontainer/devcontainer.json`.
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

## Verify the image before deployment

The Docker build normalizes application permissions after building and pruning development dependencies, before copying files into the runtime image. Keep this normalization: source archives can contain files readable only by their original owner. Application files remain owned by root and readable by the non-root Node user; only the data directory needs application ownership. Repeating recursive permission changes after the runtime copy adds another image layer containing copied-up files.

The `docker-image` CI job builds the exact source revision on a disposable runner and starts the Devnet release profile with its own PostgreSQL database and generated test credentials. Image checks cover non-root access, executable dependencies, writable data, read-only source, safe browser settings and matching source identity. HTTP and browser checks exercise the actual built assets. These checks do not establish public hosting, real wallet acceptance or on-chain settlement, and do not deploy the image to the workspace preview.

For an already running, explicitly selected local Devnet container, set `FUNDED_EXPECT_BUILD` to the full source revision before running `node scripts/verify-container-image.mjs <container>`. Optionally set `FUNDED_EXPECT_IMAGE` to its immutable image ID. The verifier checks image labels and runtime identity, performs one uniquely named data-directory write, and removes that probe immediately. It never submits a transaction or starts an X worker.

Keep image-layer sizes separate from physical disk usage. Moving permissions earlier can reduce a runtime layer without reclaiming existing images or proving a lower peak build-space requirement. Do not reduce the capacity thresholds from image history alone. A local capacity failure can leave the running preview on an older revision even when source and CI are current; report both identities explicitly.
