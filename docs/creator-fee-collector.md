# Devnet creator fee collection

The `fee-collector` service in `compose.fee-collector.yml` checks verified per-mint Pump fee vaults every five minutes. At 0.01 SOL or more of accrued fees, it calls the authenticated keeper collection endpoint and records a settlement allocation. It also reconciles collected, verified receipts that have not yet received a settlement or reward request. A collection with uncertain transaction evidence is locked for operator review, so it is not submitted again automatically.

The creator's allocated share remains in the router until the verified launch wallet requests payout. The token page enables **Claim creator fees** after the creator's unrequested allocations total at least 0.01 SOL. The wallet signs a five-minute, single-use message naming the mint, amount, and allocation IDs. The reward worker then funds and pays those immutable requests to the launch wallet. A click or queued request is not a completed payout; the page shows a paid amount only when a finalized balance-delta proof is recorded.

This service is Devnet-only. The current collector handles the Pump per-mint creator vault route; it does not establish automatic post-graduation AMM fee collection. No API token or keeper key is sent to the browser.

To inspect the service, run `docker ps --filter name=fundedapp-fee-collector-1` and `docker logs --tail 30 fundedapp-fee-collector-1`. A healthy tick logs the number of verified mints checked, new collections, and settlements. The operator endpoint `GET /api/keeper/collection-candidates` requires the API bearer token and lists blocked mints needing reconciliation.
