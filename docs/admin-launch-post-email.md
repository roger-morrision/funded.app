# Launch post drafts by email

The primary Devnet app can email a ready-to-copy X post to the configured administrator after a newly registered launch has finalized. The admin reviews and posts it manually; this does not enable the X publisher or bill a marketing delivery.

Enable `FUNDED_LAUNCH_POST_EMAIL_ENABLED=true` only on the primary app. It uses the existing Gmail SMTP configuration: `FUNDED_ADMIN_EMAIL`, `FUNDED_ADMIN_EMAIL_FROM`, `FUNDED_ADMIN_EMAIL_PROVIDER=gmail` and the server-side Gmail App Password reference. Set `PUBLIC_APP_URL=https://richpad.fun`. Keep the flag disabled on development, restore and API-only instances. Production activation remains disabled with the rest of the Mainnet release.

Registration inserts a `launchPostEmails` outbox row in the same database transaction as the verified launch. The worker checks the finalized receipt again, including network, mint, creator, name and signature, then sends the draft and token link. The recipient always comes from server configuration. Token names are sanitized, X copy fits the character limit, and Devnet drafts retain a test label. No private keys, OTPs or wallet credentials are included.

Existing launches are not automatically backfilled. Retrying a registration or restarting the worker does not resend a completed email. Delivery is limited to one attempt per minute across API replicas. Known failures before SMTP delivery retry up to five attempts. An ambiguous response after message submission, or a crash after delivery but before saving its acknowledgment, becomes `uncertain` and is not automatically resent. Inspect the admin inbox and private outbox before any explicitly requested manual recovery. `sent` means Gmail accepted the message; it does not prove inbox delivery or publication on X.

The queue is stored in the existing `state_entities` table, bucket `launchPostEmails`, and is included in the consistent database backup. Restored environments must leave delivery disabled. No new public endpoint or email-recipient override is exposed.
