# Real container acceptance — 2026-10-04

Tested two actual production-mode API containers sharing PostgreSQL 17. The HTTP, authentication, restart and browser checks below did not intercept requests or substitute an in-memory/file database. They are local acceptance evidence, not a public deployment or mainnet approval.

## Candidate identity

- API origins: `http://127.0.0.1:8788` and `http://127.0.0.1:8789`.
- Build identity: `local-container-verification`.
- Image: `sha256:e26e279d3b32169056a4f042f8cb3acb7d9965f2e2201028243bc6c2b962400a`.
- Built browser source digest: `7eb65c57fe3819d5c2f79173c22399e4de5ac542d5edda91443e5fb63417b973`.
- Devnet only; browser test-wallet signing and mainnet disabled; no financial signers configured.

This candidate predates the final optional-startup and JSON metadata MIME corrections. Rebuild and rerun the container checks for the final release image; these results identify exactly the image exercised.

## Passed checks

- Actual PostgreSQL-backed capabilities, health, expected build identity and browser settings.
- Actual Devnet genesis probe returned an operational network result; database availability remained distinct from settlement verification and mainnet authorization.
- Anonymous privileged operations rejected, API responses uncached, HTML revalidated and content-hashed JavaScript immutable.
- Built assets and supported Explore, token, launch/coin and wallet deep routes served successfully. The new-launch form uses `/#launch`.
- Disposable wallet signatures authenticated chat sessions. Two replicas concurrently verifying the same challenge returned exactly one success and one rejection.
- A session approved through the shared database could post through the second replica and read through the first; an impersonated author was rejected. Messages were deleted and sessions revoked after testing.
- Restarting the first API container preserved both an already approved session and a still-pending challenge. Replaying that challenge failed after successful verification.
- Chromium exercised Explore, Launch and Docs at 1440 and 390 pixels against the real container API: **6/6** combinations passed, with no request interception, uncaught browser exceptions or document overflow. Docs rendered the actual service status.

Machine-readable evidence: [container-acceptance-2026-10-04.json](container-acceptance-2026-10-04.json).

## Reproduce HTTP acceptance

With the disposable local container stack running:

```sh
FUNDED_CONTAINER_BASE=http://127.0.0.1:8788 \
FUNDED_CONTAINER_REPLICA=http://127.0.0.1:8789 \
FUNDED_EXPECT_BUILD=local-container-verification \
node scripts/verify-container-http.mjs

FUNDED_CONTAINER_BASE=http://127.0.0.1:8788 \
CHROMIUM_PATH=/usr/bin/chromium \
node scripts/verify-container-browser.mjs
```

The harness rejects non-loopback origins. It signs authentication messages in memory, writes and deletes one random-mint chat message, and revokes its session. It does not sign or broadcast Solana transactions. The replica uses the first origin for the common CORS boundary.

## Issues discovered

The first real image could not run as the unprivileged Node user because copied source retained restrictive file modes. Release engineering corrected image readability while retaining the unprivileged user and writable data ownership. Static JSON release metadata was served as `application/octet-stream`; backend corrected its MIME type and added a regression check.

Separate targeted browser failure injection exposed a second startup blocker in automatic reward loading. After backgrounding that optional refresh, the workspace became usable while its status request was still unresolved. A failed optional module now permits subsequent modules to initialize and presents reload recovery. These two checks use intercepted failure fixtures and are recorded separately from the real container evidence.
