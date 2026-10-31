# Persistent left navigation

All app routes use the shared `left-navigation.css` layout, including Home, token and wallet detail pages, and the separate Admin page. The old route-specific horizontal desktop menus and sidebar width exceptions have been removed.

- Desktop and tablet: a fixed 220 px sidebar, with the existing 76 px collapse option and saved preference.
- Phones: an always-visible 76 px rail. The menu button expands it to show full labels; closing it restores the rail. The rail remains available to keyboards and assistive technology.
- Site links no longer move into a bottom menu. Token pages retain their separate Buy/Sell action dock and existing trade-sheet behavior.
- The main content reserves the sidebar width. Navigation scrolls independently, and the active item inside More opens its group at every breakpoint.
- Admin uses the same left-side geometry with links back to the app; its authentication and financial controls retain their existing handlers.

Validation: 33 distinct browser cases passed across targeted runs with mocked APIs, covering 320–1918 px widths, reloads, saved collapse state, direct token/wallet routes, browser history, mobile expand/close focus, fractional scaling, skip links, launch/trade interactions and Admin controls. Nine relevant unit tests, the production Devnet build, source budgets and whitespace checks passed. These UI checks do not establish on-chain settlement.
