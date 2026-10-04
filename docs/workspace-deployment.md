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
