# Runbook

## Local development
1. Install dependencies with `npm ci`.
2. Copy the env template and set required values.
3. Run the app with the intended cluster profile.
4. Validate env and wallet configuration before app usage.
5. Confirm the configured cluster matches the wallet and RPC endpoints.

## Production deployment
1. Verify environment validation passes.
2. Confirm dev mode is off.
3. Confirm all production secrets are present and rotated.
4. Confirm RPC failover and monitoring are enabled.
5. Validate payout, queue, and database dependencies.
6. Run smoke tests for launch, claim, and reward flows.
7. Confirm readiness gate checklist passes before surfacing to users.

## Incident response
- Capture request ID and correlation ID.
- Check wallet status, RPC health, queue state, and DB health.
- Review recent transaction failures and payout anomalies.
- Stop risky features if production safety gates fail.
- Roll back by reverting the deploy if the issue is production-impacting.
