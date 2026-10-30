# V3 Devnet creator fee collection and distribution

The `fee-collector` service checks verified per-mint Pump fee vaults every five minutes by default. It uses the authenticated keeper endpoint only when the mint's configured collection minimum is met. Standard and disposable QA minimums are configured separately in `server/devnet-qa-minimums.mjs`. A collection with uncertain transaction evidence is held for review to prevent a duplicate submission.

Collection transfers fees into the verified per-mint V3 router. It does not complete recipient payments. Pending V3 collections require the launch creator to review and sign settlement on the token page. Allocation funding and the creator-wallet payout are separate signed actions. Holder and X rewards require their funded vaults; community funding is also separate. Operations and referral payouts need the configured approval and finalized transfer checks.

For new launches the current gross-fee split is 80% creator-directed, 8% Operations & marketing, 3% referrals, 4% Daily bonus and 5% $FUNDED buyback. Existing coins retain their saved rates. The 80% follows the creator's wallet/holder/X split. Unmatched ordinary referral levels stay in the community reserve and do not enlarge the Daily bonus pool.

This published split precedes activation of the [approved agency policy](marketing-agency-policy.md#approved-rules): 1% referrals and 2% agency. The Daily bonus allocation remains 4% under both policies; saved mint policies still govern actual settlement amounts.

Holder payouts normally use hourly cutoffs; selected Devnet QA coins use five-minute periods and reduced minimums. X claims require the allocated identity and recipient wallet. Daily bonus uses completed UTC days and verified funded sources. The buyback worker waits for its configured aggregate trigger and market/proof checks before purchasing and burning. A queued request, allocation or signature prompt is not proof of payment. Read the mint's actual conditions and finalized account/balance evidence.

This collector is Devnet-only. It checks the supported Pump per-mint fee-vault route; it does not establish automatic post-migration AMM collection. Keeper credentials are never sent to the browser. Inspect `docker logs --tail 30 fundedapp-fee-collector-1` and the authenticated `GET /api/keeper/collection-candidates` endpoint for pending or blocked mints. A healthy tick records checked mints, collected receipts and pending creator settlements.

See [protocol configuration](protocol-fee-split-config.md) and [Daily bonus](daily-bonus-policy.md) for current rules. Historical QA reports describe their original revisions and do not establish current runtime behavior.

## Trade-triggered processing

After an in-app trade has a finalized token-balance receipt, the browser submits its signature, mint and wallet to `POST /api/trades/finalized`. The server independently checks Devnet genesis, a recent successful finalized Pump/PumpSwap event, its trader and mint, and the directional token change. Only a verified V3 launch can enqueue a durable wake-up revision. Duplicate notifications recover the same event. Notifications do not create reward entitlements or alter a trade receipt.

Collection, buyback, holder and bonus workers observe trade revisions within their five-second polling interval, coalescing concurrent work. Existing periodic scans remain the recovery path when a browser closes, notification verification is unavailable, or trading occurs through another app. The creator still approves settlement/funding; the collector retains collection minimums and pause controls. Ranked bonus windows and holder sampling remain unchanged. A trade wakes eligible funded obligations rather than paying the unfinished window or adding distributions to the trade transaction.

The creator dashboard exposes operations and three referral payout actions in addition to creator/community/holder-X actions. Wallets supporting `signAllTransactions` can review up to three independent available payouts together. Each transaction is verified separately; an uncertain result stops the batch, preserves already finalized receipts, and requires refresh/reconciliation. This is not a standing delegation of creator signing authority.

`GET /api/automation/wakeup` and `/api/automation/status` require keeper authorization. The latter projects recorded flow stages and flags funded payouts over ten minutes late, unresolved signed payments, and buyback accounting conflicts. A primary-process monitor persists bounded alert summaries every minute and logs changed actionable alerts. The authenticated admin workspace displays that health and its freshness. Recorded monitor results never replace independent on-chain execution checks.

Contract changes for revocable standing authorizations or distributions inside the original swap require a separate versioned design, explicit spending/beneficiary bounds, program tests, an independently reviewed artifact and Devnet acceptance before activation. Existing creator signatures and entitlement windows cannot be bypassed by a notification or runtime flag.

Eligible holder SOL and Daily bonus SOL are sent automatically after their separate conditions pass; neither requires a recipient claim. Ordinary referral recipients also do not claim, but creator-approved V3 transfers are required. X rewards require the named identity and wallet claim. Community airdrops pay launched coin tokens through a separate snapshot/proof claim flow. See [all reward modes](automatic-rewards.md).
