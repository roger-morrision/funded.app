# Durable token metadata

New uploads can pin token images, optional promotion banners, and the metadata JSON to public IPFS through Pinata. The on-chain URI is the pinned JSON gateway URL. The database retains the signed content and image bytes as an independent copy. Existing mint records and URLs remain immutable.

Configure the server with `METADATA_STORAGE=pinata` and `PINATA_JWT_FILE` pointing to a mounted secret. `compose.metadata-pinata.yml` provides the overlay; set `FUNDED_PINATA_JWT_FILE` to the secret file path and include this overlay when preparing a release. Keep the key out of `VITE_*`, Git, build arguments, browser storage, and logs. A Pinata key needs Files write permission. See [Pinata upload documentation](https://docs.pinata.cloud/api-reference/endpoint/upload-a-file).

Without this configuration the existing Devnet-only service uses `hosted-devnet`. It must not be described as IPFS storage. Mainnet launch restrictions remain in place. Do not enable production launches until pinning is configured and a disposable Devnet launch passes the checks below. Pinata retention depends on keeping the pins and account active; monitor billing and preserve a second pin or backup. IPFS content addressing is not a promise of permanent availability.

Before a launch URI is returned, the server fetches JSON and every uploaded image through their public URLs, without authorization or cookies. It checks JSON content, image checksums, MIME types, bounded sizes, and timeouts; redirects and failed checks block launch preparation. The browser requires fresh publication verification before constructing the launch transaction. Metadata message signing is separate from transaction approval.

Verification after configuration:

1. Upload a disposable Devnet logo and optional banner; verify Pinata shows public pins for each asset and JSON.
2. Open the returned JSON URI and its image URL in a signed-out browser. Confirm name, symbol, image, and checksums match the upload.
3. Verify the signed Devnet launch uses the exact pinned JSON URI and that finalized mint metadata agrees. Confirm the image in the token page.
4. Restart the app and verify the same URLs still serve the same content. Never unpin assets referenced by launched tokens.

Use square PNG artwork, preferably 512×512 or 1024×1024, as practical guidance. Uploads are resized and compressed locally. External token discovery and logo indexing are not guaranteed by a successful upload.
