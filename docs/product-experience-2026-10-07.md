# Product experience update — 7 October 2026

## Shipped scope

- One shared visual layer across the app, with consistent mobile navigation, readable labels, spacing, focus indicators, and touch targets.
- Home prioritizes discovery and launching; platform totals and community reward groups expand on request.
- Explore uses Trending, New, and Following with one visible sort selector and a keyboard-accessible filter drawer.
- Launch uses three steps: token details, rewards and options, then review and launch. Existing quotes, fee choices, wallet checks, and transaction handlers remain authoritative.
- Portfolio separates created tokens from holdings and activity. Following preferences and reward explanations expand on request.
- Token pages put the chart and trading controls before the project description.
- Boost checkout has compact packs, active totals, exact payment review, receipt links, and payment history. Saved pending payments appear before confirmation and survive reload; a matching finalized receipt releases checkout for another purchase.
- Optional device counters cover discovery, launch steps, confirmed boosts/trades, rewards visits, and sharing. Export contains only allowed counter names, dates, and counts.

## Validation

- Read-only API outage fixture: 12 route types at 320, 390, 768, and 1440 pixels; no horizontal page overflow or uncaught JavaScript errors. Checked filters, sort, guided launch, portfolio tabs, mobile navigation, and pending boost recovery after reload.
- Three launch preview browser cases passed; 25 additional browser cases passed for headers, keyboard focus, following preferences, storage failures, privacy opt-out, trade-sharing consent fixtures, and preserving launch edits.
- Linux unit run: 417 of 418 passed. The remaining Render build identity test requires Git and checkout metadata, absent from the isolated image. All six tests in that file passed in the Windows checkout.
- JavaScript syntax check: 533 files passed.
- Browser transactions are fixtures. These results do not prove new real-wallet payments, live trades, or X publication.

## Measurement boundary

The initial UI release used opt-in device-only counters. The follow-up added a separate default-off choice for anonymous site-wide journey counts and private reports of confirmed activity; see [Product measurement](product-measurement.md) for current privacy, coverage, and operator instructions. Counts do not establish unique people or cross-day retention, and observed trading activity is not complete historical volume. Growth targets require real traffic and verified production outcomes; this UI release does not establish or guarantee them.
