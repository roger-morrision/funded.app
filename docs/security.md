# Security overview

## Core security principles
- Treat wallet state as sensitive and always validate it before any transaction.
- Fail closed when network, RPC, or feature configuration is invalid.
- Never enable developer mode in production.
- Validate all payloads and all external data before use.

## Critical protections
- Wallet connection checks before signing actions.
- Cluster/network validation before on-chain actions.
- Runtime env validation before build or deploy.
- Structured logs with request and wallet correlation.
- Production readiness gate checks before release.

## Risk areas in this app
- Launch flow and token metadata submission.
- Reward and claim logic.
- Payout and fee-routing operations.
- Worker queues and persistence operations.
- External RPC and API dependencies.

## Hardening plan
1. Validate wallet state and network before every transaction.
2. Validate all API payloads before server processing.
3. Redact secrets from logs.
4. Disable dev mode in prod.
5. Add operational observability and fail-safe checks.
6. Require production gate validation before public release.
