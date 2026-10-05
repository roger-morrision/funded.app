# Architecture and safety baseline

## Current state
This repository is already a substantial application with a Vite frontend, a Node API, PostgreSQL, Docker deployment, and multiple blockchain-oriented workflows. The major opportunity is not new features; it is reducing complexity while increasing security, observability, and production rigor.

## Target structure
A safer modern layout should look like this:

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
