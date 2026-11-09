# richpad.fun and $RICH

The current app brand is **richpad.fun**. Its platform token is displayed as **$RICH**. The official X account remains a placeholder until the owner supplies a verified handle; old account links are removed from the interface.

## Product surfaces

Navigation, page titles, SEO descriptions, wallet and trade labels, launch promotion and burn copy, reward dashboards, fees, token cards, help, Questions, in-app Docs, service terms, share cards and maintained SVG guides use the new branding. The platform-token page is `/rich`; `/funded` remains a compatibility alias for existing bookmarks. Other projects' token names and creator-supplied content are not renamed.

## Deployment handoff

The deployment templates target `https://richpad.fun`, including CORS, OAuth callbacks, public share links and new Devnet metadata URLs. The Mainnet planning origin is also recorded; Mainnet activation remains disabled and all remaining production identity/signer placeholders remain in place.

Before switching the public site:

1. Point the new domain's DNS/tunnel routing to the selected deployment and verify HTTPS.
2. Build frontend and backend together with the reviewed network, existing public token/program identities and new metadata origin. Refresh the private runtime `PUBLIC_APP_URL`, `CORS_ORIGIN`, `DEVNET_METADATA_ORIGIN` and X callback URL to match. Frozen historical release bundles are not edited in place.
3. Configure `https://richpad.fun/api/x/oauth/callback` at the OAuth provider. Leave X publishing disabled until the intended account, credentials and explicit activation are configured. No replacement X handle has been invented.
4. Keep the old metadata hosts and `/m/`, `/devnet-metadata/`, `/devnet-images/` and `/devnet-banners/` paths serving existing records, or configure a verified compatible redirect. Existing mints can contain immutable URLs using the previous domain. New registrations recognize both exact compact metadata URL formats while still binding the mint and signed content.
5. Verify wallet connection, sign-in, referral attribution, launch metadata retrieval, token navigation and payment recovery on the new origin. Browsers isolate local storage and cookies by origin; wallet/session reconnection is expected after a domain move.

This source change does not configure DNS, deploy the app, modify on-chain token metadata, create a new mint, change program addresses, transfer funds or migrate browser storage between origins.

### Cutover check on 9 November 2026

The existing public app responded with the Devnet build `e905d3ac0fcd46ee5bc869af5359f070fd39fc53` and Mainnet activation disabled. HTTPS checks to `richpad.fun` timed out and `www.richpad.fun` reset the connection from the verification environment. These failures do not establish which DNS or hosting setting is missing. The new origin must serve the app successfully before the public cutover; DNS/tunnel access or a completed route configuration is still needed. Both the current and historical metadata subdomains retain the metadata-only request restrictions.

## Compatibility and historical records

Existing `FUNDED_*` environment keys, contract/PDA names, persisted storage namespaces, signed message formats, memo prefixes and referral codes are retained where changing them would invalidate saved financial records or pending actions. They are compatibility identifiers, not the current product brand. The API accepts both historical and current airdrop eligibility labels in the UI.

The existing repository/workspace and script filenames remain valid so deployment automation and imports keep working. Dated audit evidence and transaction records preserve the names recorded at the time. The maintained HTML/SVG guides and the printable flow PDF carry the current brand. Do not rewrite financial evidence or replace a user's signed token metadata merely to rename the app.
