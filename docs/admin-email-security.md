# Admin wallet and email confirmation

Admin sign-in requires a valid signature from `FUNDED_ADMIN_WALLETS`. Every
request rechecks that allowlist and the session expiry. A new sign-in for the
same wallet revokes its previous session and pending email codes. The existing
Devnet-only admin restriction and Mainnet write protections remain in force.

All non-read admin requests pass through a central authorization gate before individual
handlers, including fees, withdrawal preparation/receipt recording, issue
updates, agency rules, X reviews, Daily bonus and legacy allocation recovery.
Login challenge/session creation, logout and the email-code request itself are
the authentication exceptions. Code requests require an already signed-in admin session.
All write methods require the configured same origin and reject query strings.
The recovery panel's transfer preparation and signed submission use
`/api/admin/v3-allocations/transfer`. Shared payout routes reject administrative
residual requests without the in-process email authorization capability; an
HTTP header or body field cannot fabricate that capability. Ordinary public
creator claims without a residual plan keep their existing signature checks.

The UI snapshots the exact JSON request, requests an email, and displays a modal
with the action and expandable request details. The eight-digit code lasts five
minutes, is bound to the session, admin wallet, method, path and complete request
digest, and can authorize one API attempt. Changing an amount, recipient or any
other field invalidates it. Five incorrect attempts invalidate the challenge.
Sending is limited to once per minute and ten per hour for the configured mailbox
across all sessions in the API process. Resending invalidates the session's old
code. Expiry, logout, allowlist removal and process restart revoke access.

Codes use cryptographic randomness; only keyed hashes are retained in memory.
They are never returned to the browser, placed in browser storage, or included
in audit records. A successful code is consumed synchronously before an audit
write and before dispatch. Concurrent reuse cannot authorize a second request.
Audit storage failure blocks the action. An authorization audit records only
the actor, route, request digest and time; it does not establish action success.

Each new protected action needs its own code. A withdrawal's later signed
submission and receipt can continue its persisted email-approved intent without
a second code. This narrow continuation requires the same admin session, exact
intent, fixed admin fee payer/recipient and both valid signatures on the unchanged
message. The signed transaction identity is persisted before broadcast. A new
amount, another wallet, another session or an unregistered signature cannot use
this approval. Manual recovery after session loss requires a new code.
Phantom must sign with the same authenticated admin wallet, which pays the fee;
the server supplies only the source's partial signature after email verification.
If email delivery fails after a transfer, reconcile its existing signature when
delivery returns; do not send another transfer to fix a missing receipt. A code
does not grant authority to sign a treasury, creator or program transaction.
On-chain signing keys can still be used outside this app: email confirmation
protects app API operations, not arbitrary transactions signed externally.

## Gmail SMTP setup (selected provider)

Set `FUNDED_ADMIN_EMAIL_PROVIDER=gmail`. The private configuration uses the
operator's Gmail address as both sender and recipient. Gmail does not require
the custom sender-domain verification used by Resend. It does require an
authenticated Google account: a generic Google API key or normal Gmail password
cannot replace a Google App Password in this integration.

1. Enable Google 2-Step Verification and create an App Password for this app.
2. Save that password in a private server file, outside Git. Do not paste it into
   chat or browser configuration. Google displays grouped characters; whitespace
   is removed when reading the password.
3. Set `FUNDED_ADMIN_GMAIL_APP_PASSWORD_FILE` to the server path. For Docker,
   instead set `FUNDED_ADMIN_GMAIL_APP_PASSWORD_HOST_FILE` to the host path and
   add `-f compose.admin-gmail.yml` last. It mounts the password read-only at
   `/run/secrets/funded_admin_gmail_app_password`.
4. Load `.env.admin-security.local` into the server/deployment environment and
   verify inbox delivery with a harmless Devnet admin action. It is not loaded
   automatically. Keep Mainnet writes blocked until their separate release gates
   are satisfied.

Delivery uses Nodemailer with the fixed endpoint `smtp.gmail.com:465`, TLS 1.2
or newer, certificate verification, short DNS/connection/socket timeouts, and no
SMTP debug logging or attachment/file/URL access. SMTP authentication uses the
configured sender address and the app password. Missing credentials, rejected
recipients, authentication errors or timeouts stop authorization; there is no
automatic retry or provider fallback. SMTP acceptance is not inbox delivery.

Gmail receives the same limited email content described below. Wallet addresses,
amounts, full request payloads and signing keys are never included. Changing the
Google account password revokes app passwords. Some accounts do not offer app
passwords; those require a separate OAuth2 integration, which is not implemented
by this SMTP change.

References: [Google App Passwords](https://support.google.com/accounts/answer/185833)
and [Nodemailer SMTP](https://nodemailer.com/smtp).

## Optional Resend setup

The operator approved Resend with limited disclosure. Its email contains the
recipient, confirmation code, a general action name, expiry, app origin,
network and request fingerprint. No wallet addresses, transfer amounts, exact
request body, raw route, cookies or signing keys are sent to Resend. The API key
is sent only as provider authorization to the fixed HTTPS Resend endpoint.
Delivery acceptance is not proof that a message arrived in the inbox.

Use [the server configuration template](../config/admin-security.example).
The chosen recipient is retained separately in ignored `.env.admin-security.local`;
do not commit that private file. Configure a verified Resend sender address and
a server-side API-key file. The browser cannot change the recipient or provider.
Unset or placeholder sender/provider/key values block writes; there is no
development bypass or fallback to wallet-only writes. Reads and logout continue.

For a local server, merge the private configuration into the process environment
using Node's `--env-file=.env.admin-security.local` option. The private file is not
automatically loaded. For Docker Compose, include that file with the deployment
environment files, set `FUNDED_ADMIN_EMAIL_API_KEY_HOST_FILE` to the host secret
path, and add `-f compose.admin-email.yml` last. The optional overlay mounts the
secret read-only at `/run/secrets/funded_admin_email_api_key`. Do not put a host
filesystem path into a container variable without mounting it.

Both admin sessions and codes are process-local. Restarting fails closed and
requires signing in again. Multiple API replicas require routing affinity for
sessions; mailbox throttling is per process. A shared atomic session/code/rate
store is required before claiming a fleet-wide rate limit or seamless failover.

## Verification boundary

`node --test tests/admin-email-*.test.mjs` covers real local HTTP wallet sign-in,
all admin write families, code replay and request binding, expiry/attempt limits,
logout and session replacement, delivery and audit failures, and browser request
freezing. Gmail tests check verified TLS, credential isolation, limited message
content, rejected recipients, errors, connection cleanup and no fallback.
Provider delivery uses an injected fake transport in tests. No live
email, wallet-extension withdrawal or Mainnet operation is established by these
tests. Configure the sender and secret, then verify inbox delivery and a harmless
Devnet update before treating email protection as operational.
