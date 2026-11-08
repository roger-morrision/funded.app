# Home Featured placements

Home highlights verified paid launch promotions, finalized paid boosts and paid manual listings in a banner-card rail below the introduction. Every eligible token appears; this list is independent of the market feed, its pagination and the visitor's filters.

- Launch promotions and paid listings last 48 hours from their verified launch or listing time. Paid boost placement lasts until the boost's effective expiry, including purchased extensions. Updating metadata does not restart it.
- A token appears once, using its most recent qualifying placement. At boost expiry, its Paid boost label and active multiplier disappear. A separate, unexpired launch promotion or listing can keep the token Featured under its own label; otherwise its card disappears.
- New boost purchases add their quantity immediately and add their package hours to the active boost's remaining time. For example, 10× with 5 hours left plus a 10×/12-hour purchase becomes 20× for 17 hours. All still-active packs share the extended expiry. After expiry, a new purchase starts fresh. Existing receipts remain unchanged; extensions are projected from unique finalized payments in chain order. Earlier quotes retain their original separate-expiry policy until a new stacking purchase extends their still-active packs.
- Cards identify the paid placement, display the full token identity and link to the token. Available verified artwork is shown; a monogram is used when artwork is absent or fails.
- The list refreshes each minute while Home is active and on reconnect. Expired cards are removed locally even during a refresh failure. Unverified, pending, future-dated and wrong-network records are excluded.
- Cards move from right to left and pause on hover, keyboard focus or the Pause control. Touch and arrow-key scrolling remain available. Reduced-motion preferences disable automatic motion. Animation stops when the rail is offscreen or the document is hidden; cloned cards are excluded from the keyboard and screen-reader sequence.

Focused regression tests cover the 48-hour boundary, exact boost expiry, overlapping boosts, promotion/listing fallback without an API refresh, payment eligibility, more than 40 placements, duplicates, endpoint projection, metrics and escaped card markup.

## Card metrics

The compact card footer shows MC and MC Δ 24h on one line. Launch age and distinct wallet-holder count appear in a readable strip over the banner. MC reuses the confirmed curve/pool read and current SOL/USD quote. MC Δ is an **estimate**, prefixed with ≈: it applies verified 24-hour token price change at current supply and SOL/USD rate. It is not a historical circulating-supply/USD reconstruction. Without a valid full-period baseline it stays —. Holder counts reuse the confirmed account-owner cache; ≥ denotes a lower-bound sample. Values older than five minutes are withheld. External listing or boost payment time never substitutes for launch age. Paid-placement disclosure remains in the Featured header and the card's promotion/listing badge.

Metrics refresh in place, preserving card links, keyboard focus and the scrolling position. They share the existing market and holder reads instead of starting another scan per card.
