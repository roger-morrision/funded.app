# Mainnet wallet and transaction cost inventory (preparation only)

This proposal pins the public release identities and the currently reproducible unsigned deployment prefix. It is **not a funding instruction or deployment authorization**. The final wallet top-ups remain unset until every setup, worker and canary message has an assigned payer, refreshed fees and a bounded exposure. No transaction was signed or sent to produce this inventory.

## Frozen inputs and provenance

| Input | Exact identity |
| --- | --- |
| App source for this inventory | `c66cccedf44f2f43b2afee3d9c0c426e3f705712` |
| App public deployment plan | `config/mainnet-deployment-plan.json`, SHA-256 `5646de2feff7740d35d7f55ba8a7c54175da007acf5fcf3df8a054b67f5ef596` |
| Contract source / artifact | `971399ff4e2ebdeca76a3e16a80273db38a8bfa0` / ExUNA ELF 1,110,424 bytes, SHA-256 `3f8aaffc8b308df74cafe7fff22ad37e0ee2a33e28f747468804c36c66024e50` |
| Contract packet | `docs/evidence/production-contract-handoff-2026-11-22.json` at `af2e997d3685616ebc6c96113a0bdd5a456dd8d2`, raw Git-blob SHA-256 `c7a9d8a9982c552b2c951487bdbc202d971e32179e9f21d95247b58c3df76e05` (CRLF checkout-byte SHA-256 `a732b307a745fc1bcff522bdd1267b2f93728855e9a0cbc24ca2fde08a154cd3`) |
| Unsigned Loader prefix | 1,236 messages, retained JSON SHA-256 `ac4e2708c14bbc7d341268bbe44d133ae0c54ce2e1789645f3b9dbf28d64dd5a`; Contract packet `productionQuote.deploymentProjectionFromMessages` |
| Genesis / program / ProgramData | `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d` / `ExUNAWehW776wp6Aw8noYkuGDMvgdHYKdk7jGm6PXghZ` / `ETH5QpSQrKAqS1y2RDntJzXeTU9D79u1gz8hCUY4zsQT` |

The Contract's native Loader rehearsal demonstrates same-payer buffer recycling for these bytes. Its full *deployed* ProgramData hash is necessarily unknown before finalized deployment and must be compared afterward. The retained account-state context was finalized slot 472592348; the rent table was checked at 2026-11-22T15:33:03.906Z without a returned rent RPC context slot. Loader fee classes were sampled at finalized slots 472592374 and 472592375, and unsigned messages captured at slot 472592359. All values must be refreshed before execution. The unsigned messages contain expired blockhashes and are review fixtures, never reusable signing requests.

## Read-only balance refresh

At **2026-11-23 05:57:52 UTC**, a single public Mainnet `getMultipleAccounts` query with `commitment=finalized` and zero-length data slices returned context slot **472833674**. In request order E9, 5Thg, ExUNA, Ahqt, CDCG, Dmf2, all six account entries were absent and their balances were **0 lamports**. The minimized public capture is `docs/evidence/mainnet-role-balances-readonly-2026-11-23.json`, SHA-256 `35b67569aaeceeaf8dcf8381353cb89c2571c197567e51446c33eb9a2b9cb6c4`. This refresh establishes balances only; it does not refresh rent, priority bids, executable bytes, pool liquidity, ownership, or finality of any transaction. Refresh accounts and quote immediately before signing.

## Ordered messages and cost boundary

| Order | Message or stage | Signers / direct payer | Retained quote and remaining work |
| --- | --- | --- | --- |
| 1 | Create Loader buffer | E9; E9 fee payer | One unsigned message, 5,000 lamports base fee. E9 fronts 5,641,792,120 lamports temporary buffer rent. |
| 2 | Write ELF | E9 fee payer, 5Thg buffer authority | 1,234 unsigned messages at 10,000 lamports base fee each. Verify uploaded bytes before deployment; refresh blockhashes/signatures in sequential batches. |
| 3 | Fresh Loader deployment | E9 fee payer, ExUNA program identity, 5Thg authority | One unsigned message, 15,000 lamports base fee. Buffer balance returns to the **same E9 payer** before ProgramData funding in the tested Loader path. Permanent program plus ProgramData rent is 5,642,665,880 lamports. |
| 4 | Initialize router | Ahqt operator and 5Thg admin; final fee payer unassigned | Router rent 1,315,720 lamports debits Ahqt. Build final unsigned message, decide fee payer and quote it. |
| 5 | Configure protocol guard | 5Thg admin; Dmf2 guardian read-only nonsigner | Requires a reviewed `daily_cap_lamports` value and assigned fee payer. No new account rent in the current instruction. |
| 6 | Configure price signer | 5Thg admin and CDCG price signer; final fee payer unassigned | Price config rent 853,440 lamports debits 5Thg. Build final message and quote fees. Distinct keys do not themselves prove independent custody. |
| 7 | Configure primary asset revision 1, venue 0 | 5Thg admin; retained example has E9 fee payer | Current and history account rent 3,098,800 lamports debits 5Thg. Retained example base fee was 10,000 lamports at slot 472592349; it is unsigned and expired. Uses existing 7R4 mint and 58Xq pool. |
| 8 | Postdeploy validation and limited canary | Actual selected workers and fee payers, not yet assigned | Construct exact ATAs/lookup tables only if required, price/guard/operator setup, bounded canary and rollback/stop messages; quote each wire, rent, base/priority fee and maximum exposure. Verify finalized executable, authority, full ProgramData and state transitions. |

Loader-prefix base fees total **12,360,000 lamports** (1 × 5,000 + 1,234 × 10,000 + 1 × 15,000). At the retained rent sample, E9's deployment-prefix balance requirement after same-payer buffer reuse is **5,655,025,880 lamports** (5,642,665,880 permanent rent + 12,360,000 base fees), plus any changed rent, priority bids, failed attempts or unpriced E9 messages. The temporary buffer is a peak liquidity requirement within that sequence, **not an additional permanent rent charge**. If the same-payer recycling premise changes, recompute the peak rather than using this number.

## Wallet-by-wallet known minimum, not final top-up

| Role and full public address | Finalized balance at slot 472833674 | Known direct debit / protected reserve | Known minimum available balance from retained quote | Final top-up |
| --- | ---: | --- | ---: | --- |
| Deployment payer `E9tQpKSi29HczaYdJKbiPLf2uhYEbNhq19muExsRdmgL` | 0 | 5,642,665,880 permanent Loader rent; 12,360,000 quoted Loader-prefix base fees; 5,641,792,120 temporary buffer recycled | **5,655,025,880 lamports**, conditional on unchanged rent/fees and same-payer recycling | **Undetermined** |
| Admin and upgrade `5ThgFz4yFPX6fQ8mdaPjtKXeYYA6RwEMjkC2vaPMA6oi` | 0 | 853,440 price config + 3,098,800 primary current/history rents | **3,952,240 lamports**, before any assigned fees | **Undetermined** |
| Operator `AhqtNTDn7F1JVJGnSbWHtGCDFmxMunJPEgUbfPxQyz95` | 0 | 1,315,720 router rent and the **single** protected 3,000,000,000-lamport operating reserve | **3,001,315,720 lamports**, before worker fees, rents or canary exposure | **Undetermined** |
| Price attestor `CDCGMm998cb5zDwmeC31KAZWukD2KKYKPsNHVjdicmEF` | 0 | 0 known if read-only co-signer with another fee payer | **0 conditional** | **Undetermined** |
| Offline guardian `Dmf2SqmWybu1KF4PjmqfJcfszJQq8UnS7zH8ZAYNqHQQ` | 0 | 0 known for reviewed read-only, nonsigning guard meta | **0 conditional** | **Undetermined** |
| Program identity `ExUNAWehW776wp6Aw8noYkuGDMvgdHYKdk7jGm6PXghZ` | 0 | 0 direct user transfer; E9 funds program rent in Loader messages | **0 direct transfer** | **0 direct transfer for reviewed prefix** |

Known minima above total **8,660,293,840 lamports**, including the one 3 SOL reserve. This is an arithmetic floor from stale quote inputs, **not** the aggregate cost, final payable amount, or permission to fund. The Contract's older **9,017,665,880-lamport** illustration includes provisional setup/canary/contingency allowances; its unassigned portions cannot be assigned to wallets yet and must not be added again to individual fees. The protected reserve cannot pay the operator's fee/rent obligations. No new mint, pool creation or liquidity principal is proposed for the existing selected PumpSwap route.

## Conditions for a final funding and signing packet

1. Freeze the merged App source, independently accepted production ELF, genesis/program/ProgramData identity and exact worker admission. Keep the final postdeployment full ProgramData hash separate from the predeployment ELF hash.
2. Establish reviewed, operationally separate operator and price custody and a guardian recovery procedure. Current deployment plan has null signer/infrastructure references even though public identities are selected. Confirm backup/restore of the controller, price and operator journals before admission.
3. Approve the guard daily cap and a bounded canary amount; inventory every exact setup/ATA/ALT/worker/canary/rollback wire and payer. The existing 50,000,000-lamport canary exposure and 44,732,040-lamport unassigned setup figures are illustrative allowances, not approved debits.
4. Refresh finalized balances/account existence, rent, pool state, blockhash and `getFeeForMessage` for each final wire, including any priority bid. Reconcile failed or uncertain attempts before any retry. Specify expiry and stop conditions.
5. Compute for each wallet `max(0, peak required available balance - refreshed finalized balance)` only after all actual debits and refundable deposits have been assigned exactly once. Show decoded purpose, message hash, signers, writable accounts, mint/pool, amounts, minimum output and expected finalized deltas. Submit the costed proposal for approval **before spending**.

The on-chain fees are variable, and Solana charges transaction fees even when a transaction fails; see [Solana fees](https://solana.com/docs/core/fees) and [fee structure](https://solana.com/docs/core/fees/fee-structure). A recent blockhash and its signatures expire; refreshed messages need a new identical-byte signature set, as described in [Solana transactions](https://solana.com/docs/core/transactions). The balance query's returned context slot is defined by [getMultipleAccounts](https://solana.com/docs/rpc/http/getmultipleaccounts).
