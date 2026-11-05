# Architecture and safety baseline

Product workflows: [all-page guide](product-guide.md). Documentation scope and dated evidence: [index](README.md).

## Current implementation
The app uses a Vite browser client, a Node API, PostgreSQL and separately gated
financial workers. Browser startup and controllers live in `src/app`; feature
views live in `src/features`; API dispatch, proof and worker modules live in
`server`. Root modules still provide shared policies, wallet and transaction
builders. `config` contains validated defaults; a verified published policy or
saved mint policy can take precedence.

Product guidance lives in `src/features/help`: `product-guidance.js` supplies
Questions/FAQ, reward actions and Help; `page-guidance.js` supplies shared page
explanations and context selection; `docs-topics.js` builds the full Docs catalog.
Fee explanations read the shared live policy bindings rather than duplicating
current rates across pages. `docs-reference.js` handles guide search and deep links.

Collection, settlement, funding, eligibility and payment are separate operations.
Automatic and manual routes share saved-policy and finalized-proof requirements.
Read-only views never establish execution by themselves. See the product guide
for page ownership and the automation guide for financial gates.

See [Code structure and file-size limits](code-structure.md) for implemented
feature boundaries, ordered stylesheet modules, verification, and the remaining
legacy files. The size check runs in `npm run check`.

## Deployment services

Docker Compose groups distinct services under `fundedapp`; the group itself is
not another container. The enabled overlays and profiles determine the inventory.

| Service | Responsibility |
| --- | --- |
| `app` | Browser assets, API and authenticated user workflows |
| `db` | PostgreSQL records and durable financial/application state |
| `rpc-gateway` | Shared Solana request pacing, deduplication and provider access |
| `rpc-cache` | Private Redis cache for reusable RPC reads |
| `tunnel` | Cloudflare connection for public access to the local deployment |
| `fee-collector` | Eligible fee collection and gated automatic processing |
| `buyback-worker` | Protected $FUNDED purchases and burns |
| `agency-buyback-worker` | Protected own-coin purchases and burns for saved agents |

Separate workers allow independent recovery and keep long-running financial
processing apart from web requests. Cache and tunnel are deployment choices;
stopping a configured dependency can interrupt access or processing. Running
container count is not a memory measurement. Inspect actual usage separately
from Docker's available memory limit. Health checks establish service readiness,
not a finalized payment or burn. See `compose.preview.yml`,
`compose.rpc-gateway.yml`, `compose.fee-collector.yml` and
`compose.agency-buyback.yml` for wiring and activation gates.

## Possible future structure
The following is a refactoring proposal, not the current directory inventory:

- src/
  - app/
  - features/
    - wallet/
    - launch/
    - rewards/
    - claims/
    - explore/
    - analytics/
  - lib/
    - api/
    - wallet/
    - env/
    - layout/
    - metrics/
  - routes/
  - styles/

## Architectural principles
- Feature ownership is explicit.
- Shared UI is centralized.
- Wallet and transaction code is isolated from display logic.
- API contracts are documented and validated.
- Environment config is validated at startup.
- Development and production environments are intentionally separated.
- Features with financial risk are fail-closed.

## Recommended refactor sequence
1. Move root API helpers and wallet logic into src/lib.
2. Split giant UI files by feature area.
3. Create standardized API client modules.
4. Centralize env validation and config gating.
5. Add monitoring and structured logging.
6. Add test and CI enforcement on each refactor.

## Hardening conventions
- No production feature should rely on dev-only flags.
- Every transaction should validate chain, wallet, and feature readiness.
- All state-changing endpoints should be idempotent.
- Alerting must exist for RPC failures, queue stalls, and payout delays.
