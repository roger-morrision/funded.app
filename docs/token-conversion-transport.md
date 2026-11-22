# Reviewed conversion transport preparation

`createTokenConversionTransport` composes the accepted exact-input USDC reviewer,
locked reservation journal, two explicit signer adapters and finalized proof
reader. It has no service registration, production signer backend, new allowlist
or activation flag. Mainnet financial workers remain disabled. Synthetic local
adapter acceptance cannot establish independent operational custody or live
financial delivery.

The caller supplies the already-reviewed configuration/release tuple, a fresh
dedicated store, the RPC connection, and separate operator/price public-key
handles exposing `signMessage`. Each receives copied immutable message bytes,
the unsigned wire, role, message hash, intent digest and cancellation signal.
Signatures are verified against the durable message and original role identity.
The independent signer must still enforce its own reviewed policy and custody;
an injected callback is not evidence of that deployment.

An actual reviewer reservation must finish its durable transaction before a
one-time signing marker is committed. Only the caller that creates the new
reservation may proceed. Price signing precedes operator signing; both exact
signatures are saved before send admission. Actual review/simulation runs again,
then a one-time broadcast marker is committed before the RPC call. Review ages
are checked after durable fences as well as between signing steps. The RPC uses
preflight and zero automatic retries, and never refreshes a blockhash.

Any existing reservation is read-only recovery, including one left unsigned by
a crash. This deliberately may strand an unsent attempt until authenticated
expiry/absence reconciliation. A send-intent marker proves neither submission
nor payment. RPC errors, signer timeouts, publication errors and mismatched RPC
signatures cannot authorize another signature or send. A post-rename error may
coexist with a visible marker: recovery retains the exact identity. Only the
existing authenticated finalized transaction/receipt/custody proof can settle
the journal. Its existing verified-expiry/absence release rules are unchanged;
this transport does not construct or automatically retry replacement messages.

Run `node scripts/check-token-conversion-transport.mjs` for 28 required cases.
The public capture, current review ELF and prior proof-fixture ELF inputs are
the same as the existing 72-case conversion inventory. These are actual
reviewer/journal/filesystem/cryptographic signatures with synthetic financial
RPC, deterministic in-memory test signers and injected transport. No transaction
is submitted to a chain. Production backend admission, worker selection and
budget wiring, independent custody and live financial verification remain open.
