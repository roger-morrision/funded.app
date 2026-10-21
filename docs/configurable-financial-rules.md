# Financial enforcement and configurable launch rules

The program keeps custody, the 80% creator-directed / 20% protocol boundary,
per-category spending limits, recipient authorization, duplicate-payment
protection, reward proofs, and atomic purchase/burn verification on-chain.
Workers calculate eligibility and rankings, obtain external data, schedule
transactions, and reconcile finalized results. X publishing remains paused
until account reinstatement; changing financial settings does not resume it.

## Future-launch settings

The admin Future-launch rules editor prepares an unsigned configuration
transaction. The router authority wallet must sign it. After finalization,
the publisher independently verifies the exact transaction, signature,
configuration revision and current deployment before publishing the settings.
An admin sign-in alone cannot authorize custody spending or replace that signature.

All seven protocol categories must total 20% of gross collected creator fees.
Defaults remain Operations & marketing 8%, referrals 0.6% / 0.25% / 0.15%,
Daily bonuses 4%, FUNDED buyback 5%, and agency 2%. Agency is configurable
within that total. These are allocations of collected fees, not trading charges.

| Setting | Default | Accepted range |
| --- | --- | --- |
| Agent 2 / Agent 3 own-coin market cap | USD 100,000 / 300,000 | Whole USD 1–1 billion; second above first |
| Community token claim window | 90 days | 300–31,536,000 seconds |
| Promotion billing interval | 24 hours | 86,400–2,592,000 seconds |

`config/agency-rules.js` defines defaults. Saved authority-approved on-chain
configuration takes precedence. File edits alone do not change an active policy.
`config/marketing-agency.js` defines default fee allocations and supported agents.
`config/protocol-fee-split.js` is the older seven-category fallback, not the
published agency configuration.

## Compatibility

Configuration and mint policies use a validated 40-byte extension. Existing
77-byte configurations and 383-byte mint policies retain original defaults.
New mint policies copy the current configuration into their own 423-byte
account. Updating global settings never modifies an existing mint. Existing
community drops retain their stored expiration; future agency drops derive
their expiration from the mint's saved rule, not the latest global settings.
Unknown, truncated, or malformed extensions fail closed.

The current authority attests market observations and X delivery. A hash is
an audit commitment, not an independent USD or X oracle. The program enforces
thresholds, budgets, cadence, one-time actions and actual burn results.

## Worker settings

Holder schedules, eligibility minimums, Daily bonus ranking rules, snapshot
periods, the FUNDED buyback execution trigger and X posting quotas remain in
their existing app configuration and bounded Devnet environment settings.
Five-minute QA settings do not change mainnet defaults or erase prior snapshots.
The program does not wake itself on a timer; workers must remain operational.

## Verification scope

Local VM tests verify authority rejection, revision checks, copied settings,
legacy-policy compatibility and a five-minute community claim expiry. Browser
fixtures verify the editor and wallet gate with mocked APIs. These tests do not
prove a public deployment, wallet-extension approval, X delivery or a finalized
Devnet milestone buyback. Deployment and live acceptance require separate receipts.
