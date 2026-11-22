# Payout recovery corrections

Two independently reproduced findings on `969809a0` are corrected together;
their acceptance remains separate under FQA-MN-005.

**PAYOUT-01:** saved recovery replaced a completed payment row, losing its
`paidAt` and `bitmap:false`. A shared completion builder now writes consistent
proof facts on first success and recovery, preserving timestamps and other
metadata. A complete matching record is not replaced or written again by the
recovery pass. Incomplete records can be enriched once; conflicting paid amount,
signature, index, receipt or mode stays for review. The unchanged PM three-case
scheduler/reopened-store probe fails 3/3 before and passes 3/3 after, with no
additional submission. Custom metadata and a no-writes recovery store are covered.

**PAYOUT-02:** a non-self native or token payout could accept a changed reported
fee even though transaction balances still accounted for the original fee.
The exact unchanged E2E twelve-case ordinary/self probe reproduces seven passes
and five failures on the baseline; all twelve pass after correction. The verifier
now requires full native conservation (`sum(pre - post) == fee`), the frozen fee
quote, and canonical payer/receipt/optional ATA rent movements. No unrelated
native account can receive a credit or supply a debit. Native SOL self-payment
includes fee and receipt rent; wrapped-native token payouts additionally move
backing lamports between the two ATAs. Classic WSOL and Token-2022 native-mint
ordinary/self controls pass. No supported wrapped-native asset is excluded.

The signed snapshot now retains fee and maximum receipt/ATA rent inputs. Unknown
historical attempts without required cost evidence remain unresolved; this is not
permission to erase/re-sign them. A changed transaction, unbalanced metadata,
unexplained reserve credit or incorrect receipt-rent movement leaves the same
attempt prepared with no fresh blockhash or broadcast. The synthetic token bank
now records real ATA creation rent and payer fees; the native-token variants
also emulate their backing-lamport movement. These remain synthetic unit facts,
not compiled or live financial evidence.

The metadata-only Token-2022 rent boundary also exposed a no-account-extension
mapping marker incorrectly counted as storage (174 instead of 170 bytes). The
mapping now drops that marker and retains immutable-owner/required extensions;
a synthetic mint with MetadataPointer/TokenMetadata TLVs covers this quotation
boundary, without claiming compiled extension-specific transfer acceptance.

Cached verified proof also binds its fee, payer and amount to the authenticated
attempt; changing those cached facts cannot bypass fresh-proof checks or trigger
an RPC read, signing or send. Positive cached recovery remains idempotent.

The combined required inventory has **70/70** passing cases, zero failures,
skips or TODOs: the previous 45, three unchanged metadata-restart probes, three
metadata completion boundaries, twelve unchanged native-fee probes, six
additional native/WSOL/rent boundaries and the cached-accounting boundary. Public
review-ELF absence fails closed.
Existing expiry acceptance is reused by unchanged source identity; no Contract
source, ELF, Loader quote, financial policy, cap, allowlist or runtime admission
changes. Independent review of this exact correction is pending. Mainnet remains
NO-GO; no signing request, transaction, funding or deployment occurred.
