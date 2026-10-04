# Free Devnet hosting: Render + Neon

This repository now includes `render.yaml` for a free Render Node 24 web service and an external Neon PostgreSQL database. The profile serves the app, API and new token metadata from one HTTPS origin. It disables mainnet, server-held test wallets, payouts and financial executors. It does not launch background workers. It is a public testing profile, not complete financial-service acceptance.

## Grant GitHub access to this workspace

1. In [GitHub installed applications](https://github.com/settings/installations), open the OpenAI/Codex integration that supplies this environment. Choose **Configure**, grant access to `roger-morrision/funded.app`, and accept any pending permissions update. Reconnect GitHub in the workspace settings. If the repository belongs to an organization, its owner may need to approve access.
2. If the integration cannot provide write access, create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new). Choose the repository owner, **Only select repositories → funded.app**, and grant **Contents: Read and write**, **Workflows: Read and write**, and **Pull requests: Read and write**. Set an expiry. Metadata read permission is automatic. Organization approval may also be required.
3. Store the token as `GH_TOKEN` through the environment's secret settings. Do not paste it in chat, put it in a Git remote URL, or commit it. The token must be available to the execution environment, not just a GitHub Actions secret. A configured Git credential helper may take precedence; the assistant can use the authorized token explicitly without displaying it.
4. Tell the assistant that access is configured. It can retry publishing branch `enhancements/devnet-readiness-2026-10-04` and create a reviewable pull request. The current push attempt received HTTP 403; local commits are not yet on GitHub.

Workflow write permission is needed because this delivery changes `.github/workflows`. Connecting a read-only GitHub integration is insufficient for publishing these changes.

## Create the free host

1. Sign up at [Neon](https://console.neon.tech/) and create a dedicated **Devnet** project in a region near the intended Render service. Copy its PostgreSQL connection string with TLS enabled. Use a fresh database, not an existing production database.
2. Sign up at [Render](https://dashboard.render.com/), connect GitHub, and authorize access to `funded.app`. After the branch is published, choose **New → Blueprint**, select the repository and enhancement branch, and use `render.yaml`.
3. When Render prompts for `DATABASE_URL`, enter the Neon connection string in Render's secret environment settings. `FUNDED_API_TOKEN` is generated automatically. The build/start helper derives the public URL and exact commit from Render's provided environment, applies migrations, requires verified database TLS, refuses signing keys, and skips local `.env.local` and `*_FILE` secret loading. Set hosted credentials directly in Render's secret environment settings. The startup guard also checks the clean release manifest matches the built origin and Render commit. Do not add test-wallet private keys.
4. Deploy and use the assigned `https://….onrender.com` URL. Start with this URL; moving `funded.vip` requires separate DNS/Cloudflare access. A future custom domain requires setting `PUBLIC_APP_URL` to that HTTPS origin and rebuilding so browser metadata URLs and server origins match.
5. Check `/api/health`, `/api/status`, `/build-settings.json`, and `/release.json`. Health proves the process is serving requests; `/api/status` reports dependencies, while `/api/readiness` may correctly report disabled financial services. Verify the release commit, sign in with a disposable Devnet wallet, and test metadata, chat and launch availability before advertising a complete workflow.

Automatic deployments are disabled in the Blueprint. Existing tokens retain their recorded metadata origin; restoring the old metadata domain is still necessary for old on-chain URLs. New tokens use the new origin. Do not delete the Neon project to reset the UI: it contains persistent records and metadata.

## Let the assistant configure hosting

The assistant currently has network/API access but no Render or Neon account credentials. To allow API setup, store a Render API key as `RENDER_API_KEY` and a Neon API key as `NEON_API_KEY` in environment secret settings. Use dedicated Devnet accounts/projects and share only public project/service identifiers in chat. Render's separate GitHub integration still needs repository access to build private code. Alternatively, create the two services manually using the steps above; providing account keys is optional.

## Free-tier limits

- Render's free web service sleeps after 15 minutes without inbound traffic and may take roughly a minute to wake. Metadata and wallet callbacks can time out during cold starts. Its filesystem is ephemeral, so application records and uploaded token images use PostgreSQL.
- Free Render services have no persistent disks or always-on background workers. Automated reward processing requires an always-on host and durable reward state before enabling it. This profile deliberately leaves those services unavailable.
- Neon currently offers a free plan with no card/time limit, 1 GB storage per project and 100 compute-unit hours per month per project; autosuspend applies. Check current quotas in your account. Uploaded images consume database space. Render's free PostgreSQL expires after 30 days, which is why this configuration uses Neon.
- Public Solana Devnet RPC can rate-limit. A dedicated Devnet RPC URL can be stored as `SOLANA_RPC_URL` without exposing credentials to browser builds. Hosting-provider outgoing traffic limits also apply.
- This is not a mainnet availability, backup or custody setup. The isolated recovery drill proves the application's restore path; configure offsite backups and retention for the hosted database separately.

Sources checked October 4, 2026: [Render free services](https://render.com/docs/free), [Blueprint reference](https://render.com/docs/blueprint-spec), [Render API](https://render.com/docs/api), [Neon pricing](https://neon.com/pricing).
