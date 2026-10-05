# Production readiness checklist

## Security
- [ ] Wallet/network checks are enforced before all tx actions.
- [ ] All environment variables are validated at startup.
- [ ] Dev mode is disabled in production.
- [ ] Secrets are redacted from logs and diagnostics.
- [ ] Public endpoints have rate limits.
- [ ] Admin/internal endpoints are isolated and protected.

## Reliability
- [ ] RPC failures have retries and backoff.
- [ ] Worker queues have health checks.
- [ ] Database availability is monitored.
- [ ] Failed payouts are queued and auditable.
- [ ] Critical actions are idempotent.

## Observability
- [ ] Request IDs are present on all critical flows.
- [ ] Structured logs are emitted for wallet and API actions.
- [ ] Alerts exist for payout, queue, and RPC failures.
- [ ] Operational dashboards are reviewed regularly.

## Quality
- [ ] CI is required on every PR.
- [ ] Build and smoke tests are mandatory.
- [ ] Regression tests cover wallet, launch, rewards, and claim paths.
- [ ] API changes require schema validation.

## Product trust
- [ ] Devnet/prototype features are clearly labeled.
- [ ] Users can understand risks and fees before signing.
- [ ] Critical features explain what is being done and why.
- [ ] No unsupported or hidden experimental flows are active in the default path.
