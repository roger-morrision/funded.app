# Persistent left navigation

All app routes use the shared `left-navigation.css` layout, including Home, token and wallet detail pages, and the separate Admin page. The old route-specific horizontal desktop menus and sidebar width exceptions have been removed.

- Desktop and tablet: a fixed 220 px sidebar, with the existing 76 px collapse option and saved preference.
- Phones: the menu button opens a left-side drawer. Closing it returns the full width to the page; closed navigation is excluded from keyboards and assistive technology.
- Site links no longer move into a bottom menu. Token pages retain their separate Buy/Sell action dock and existing trade-sheet behavior.
- The mobile overrides account for shared CSS being emitted before page CSS in production. Non-token pages have no empty bottom bar; token pages retain a full-width trade action dock.
- Desktop content reserves the sidebar width; phones keep full-width content with an overlay drawer. Navigation scrolls independently, and the active item inside More opens its group at every breakpoint.
- Admin uses the same left-side geometry with links back to the app; its authentication and financial controls retain their existing handlers.

Validation: 33 distinct browser cases passed across targeted runs with mocked APIs, covering 320–1918 px widths, reloads, saved collapse state, direct token/wallet routes, browser history, mobile expand/close focus, fractional scaling, skip links, launch/trade interactions and Admin controls. Nine relevant unit tests, the production Devnet build, source budgets and whitespace checks passed. These UI checks do not establish on-chain settlement.
