# Home Featured placements

Home highlights verified paid launch promotions, finalized paid boosts and paid manual listings in a banner-card rail below the introduction. Every eligible token appears; this list is independent of the market feed, its pagination and the visitor's filters.

- Placement lasts 48 hours from the verified launch time, boost start time or listing time. Updating metadata does not restart it.
- A token appears once, using its most recent qualifying placement. A new verified boost can feature an older token again. This Home placement does not extend the boost package's ranking multiplier.
- Cards identify the paid placement, display the full token identity and link to the token and payment receipt. Available verified artwork is shown; a monogram is used when artwork is absent or fails.
- The list refreshes each minute while Home is active and on reconnect. Expired cards are removed locally even during a refresh failure. Unverified, pending, future-dated and wrong-network records are excluded.
- Cards move from right to left and pause on hover, keyboard focus or the Pause control. Touch and arrow-key scrolling remain available. Reduced-motion preferences disable automatic motion. Animation stops when the rail is offscreen or the document is hidden; cloned cards are excluded from the keyboard and screen-reader sequence.

Verification: five focused regression tests cover the 48-hour boundary, payment eligibility, more than 40 placements, duplicates, boost history, endpoint projection and escaped card markup. Browser checks cover desktop/mobile layout, banner delivery, motion, pause, keyboard browsing and reduced motion. Local browser preview uses the new projection with live existing launch/listing data until the new endpoint is deployed.

## Card metrics

The compact card footer shows MC and MC Δ 24h on one line. Launch age and distinct wallet-holder count appear in a readable strip over the banner. MC reuses the confirmed curve/pool read and current SOL/USD quote. MC Δ is an **estimate**, prefixed with ≈: it applies verified 24-hour token price change at current supply and SOL/USD rate. It is not a historical circulating-supply/USD reconstruction. Without a valid full-period baseline it stays —. Holder counts reuse the confirmed account-owner cache; ≥ denotes a lower-bound sample. Values older than five minutes are withheld. External listing or boost payment time never substitutes for launch age. Paid-placement disclosure remains in the Featured header and the card's promotion/listing badge.

Metrics refresh in place, preserving card links, keyboard focus and the scrolling position. They share the existing market and holder reads instead of starting another scan per card.
