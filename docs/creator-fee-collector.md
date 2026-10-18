# V3 Devnet creator fee collection and distribution

The `fee-collector` service checks verified per-mint Pump fee vaults every five minutes by default. It uses the authenticated keeper endpoint only when the mint's configured collection minimum is met. Standard and disposable QA minimums are configured separately in `server/devnet-qa-minimums.mjs`. A collection with uncertain transaction evidence is held for review to prevent a duplicate submission.

Collection transfers fees into the verified per-mint V3 router. It does not complete recipient payments. Pending V3 collections require the launch creator to review and sign settlement on the token page. Allocation funding and the creator-wallet payout are separate signed actions. Holder and X rewards require their funded vaults; community funding is also separate. Operations and referral payouts need the configured approval and finalized transfer checks.

For new launches the current gross-fee split is 80% creator-directed, 8% Operations & marketing, 3% referrals, 4% Daily bonus and 5% $FUNDED buyback. Existing coins retain their saved rates. The 80% follows the creator's wallet/holder/X split. Unmatched ordinary referral levels stay in the community reserve and do not enlarge the Daily bonus pool.

Holder payouts normally use hourly cutoffs; selected Devnet QA coins use five-minute periods and reduced minimums. X claims require the allocated identity and recipient wallet. Daily bonus uses completed UTC days and verified funded sources. The buyback worker waits for its configured aggregate trigger and market/proof checks before purchasing and burning. A queued request, allocation or signature prompt is not proof of payment. Read the mint's actual conditions and finalized account/balance evidence.

This collector is Devnet-only. It checks the supported Pump per-mint fee-vault route; it does not establish automatic post-migration AMM collection. Keeper credentials are never sent to the browser. Inspect `docker logs --tail 30 fundedapp-fee-collector-1` and the authenticated `GET /api/keeper/collection-candidates` endpoint for pending or blocked mints. A healthy tick records checked mints, collected receipts and pending creator settlements.

See [protocol configuration](protocol-fee-split-config.md) and [Daily bonus](daily-bonus-policy.md) for current rules. Historical QA reports describe their original revisions and do not establish current runtime behavior.

Eligible holder SOL and Daily bonus SOL are sent automatically after their separate conditions pass; neither requires a recipient claim. Ordinary referral recipients also do not claim, but creator-approved V3 transfers are required. X rewards require the named identity and wallet claim. Community airdrops pay launched coin tokens through a separate snapshot/proof claim flow. See [all reward modes](automatic-rewards.md).
