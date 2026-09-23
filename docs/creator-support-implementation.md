# Creator support implementation — 2026-09-20

Updated phase-by-phase implementation and verification results are in [the 2026-09-21 delivery status](phase-delivery-status-2026-09-21.md). The initial snapshot below is retained for context; its pending PostgreSQL/image/PNG items have since advanced as described there.

This is the local implementation of the Donated-inspired creator-support proposal. It does not complete every item in the broader product roadmap, demonstrate product-market fit, or activate production payments.

## Implemented

- Four primary destinations: Explore, Create, Portfolio, Rewards; secondary destinations remain under More & transparency.
- Quick creation by default, optional advanced content, beneficiary-first X preset (80% of collected creator fees, not trading volume), account lookup and explicit service-readiness messaging.
- Creator directory, stable numeric X-ID URLs, local-device following, creator-to-launch prefill, share text, downloadable SVG cards, manual browser-source overlay, and a creator launch checklist.
- Separate account-ownership verification, per-coin authorization, and fan-created/not-endorsed labels. Neither a wallet connection nor naming a handle authorizes a coin.
- X-session-protected profile settings and public updates, per-coin consent, discovery exclusion and new-registration opt-out. Existing financial entitlements are preserved. Blockchain creation outside this app cannot be prevented by an app opt-out.
- CSRF tokens, origin checks, bounded request/update sizes, write rate limits, escaped public text, file-store and PostgreSQL bucket support.
- Creator support totals join a verified collection, immutable launch allocation, X obligation, recipient claim and verified payout. Ledger status or allocation alone is not earnings. Duplicate payout signatures count once.
- Totals/milestones explicitly describe a bounded recent receipt window, not all-time earnings. Empty/unavailable evidence is not displayed as verified zero income.
- API capability/version handshake; missing/old API is identified rather than mistaken for a working claim service.
- Visible token fee-policy panel, separate launcher versus Pump fee-owner labels, mobile Buy/Sell actions, and multi-signature launch copy.
- Server-rendered creator title/description/Open Graph text metadata; unavailable/opted-out profiles return generic noindex metadata. This is not a generated social-preview PNG.

## Verification

`npm.cmd run verify:creator-support` covers local models, negative receipt joins, duplicate receipts, consent, opt-out, authenticated HTTP routes, CSRF/origin rejection, write limits, update validation, file persistence and social metadata.

Existing launch-wizard, mint-router-v2, receipt-evidence, explore-discovery, coin-detail, production-policies, proof-ui, fee-policy, backend-hardening, wallet-state and x-payout checks were also run. `npm.cmd run build` verifies frontend bundling.

Browser checks used an isolated local API/store, disabled wallet auto-connect, no keeper/authority/OAuth credentials, and an unavailable local RPC. A clearly named local QA profile tested direct creator navigation, mobile layout, following, sharing and launch prefill. It had no coin or payout records. No transaction was signed or submitted. Authenticated X settings were tested with a mocked session, not a real OAuth login.

PostgreSQL integration was not run: its explicit opt-in gate was left closed to avoid touching a shared database. File-store persistence was tested. The existing application services were not replaced by the isolated test servers.

## Activation requirements and limits

1. Restart the actual API and rebuild/reload the frontend together. `/api/capabilities` must return `creator-support-v2` with the expected cluster. A frontend-only refresh cannot upgrade an old API.
2. Use same-origin `/api` routing. Configure the exact `CORS_ORIGIN` when a reverse proxy rewrites Host. Cross-origin cookie-based creator management is not supported by this implementation.
3. Configure X OAuth and stable-ID lookup, approved Devnet keeper and router authority, verified per-mint router deployment, and settlement service. Do not enable mainnet based solely on readiness flags.
4. Prove launch → trade → collect → entitlement → X identity + wallet verification → payout with actual confirmed Devnet state/balance deltas. Exercise replay, wrong-recipient and recovery failures. This has NOT been demonstrated in this implementation turn.
5. Use a dedicated disposable PostgreSQL database to validate profile persistence/concurrent writes before rollout.
6. Run a consenting creator pilot and measure actual adoption/retention before growth promotion. No posts, invitations or influencer outreach were sent.

Twitch/Kick subscriptions and YouTube donations are explicitly disabled. There is no approved provider integration, delivery receipt, spending authorization or retry/refund policy. The overlay is a manual snapshot page; it does not auto-refresh, post stream alerts, or execute gifts. Following is local-device only. SVG downloads do not guarantee social-network image previews.

## Broader roadmap still open

Automatic image preparation; complete packet/cancellation/partial-success recovery matrix; authenticated/moderated chat; privacy-reviewed funnel analytics and user studies; production-scale indexed discovery/pagination and lifetime payout aggregates; PNG social cards; live stream alerts; multi-device follows/notifications; production infrastructure/security review and external creator pilot. Mandatory vanity suffixes and expanded tokenomics remain deferred as recorded in the product review.

See [the phased product review](product-review-roadmap-2026-09-20.md) for prioritization. Production deployment, real X identity verification, actual payouts, gifting and virality are not claimed as completed.
