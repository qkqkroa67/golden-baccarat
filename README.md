# Golden Baccarat

Static frontend for the Golden Baccarat prototype. The entry, baccarat table, mini-game, and lounge are separate pages. Navigation between game pages goes through the entry lobby. Deploy the contents of this folder from the repository root (for example, with GitHub Pages).

## Included

- Baccarat with chip bets, slow sequential card dealing, Punto Banco third-card rules and payouts.
- 20-column x 6-row result road with P/B/T as equal outcomes, streaks flowing down and along the bottom row, and reset after column 20.
- 30-second Chip Catcher mini-game. Each catch adds 20 virtual chips, capped at 500 per session. Chips feed the same bankroll used for baccarat.
- House and character cosmetic purchases using chips; baccarat rounds add fame toward player tiers.
- Local friend list; global rankings and live friend connections are marked for later backend integration.
- PWA manifest and service worker scaffolding.

## Online play status

The site is currently a single-device demo. Room creation and joining, bankroll, purchases, rewards, friends, and leaderboard are local browser state. Real shared rooms require a backend that validates membership and rewards and synchronizes room state across devices.


## Email account saves

The browser integration is in `auth.js`. To activate it, create a Supabase project, run `supabase-schema.sql` in its SQL Editor, then fill `supabase-config.js` with the Project URL and publishable (or legacy anon) key. Add the GitHub Pages site URL to Supabase Auth's Site URL and redirect URL settings. Never put a `service_role` or secret key in browser code.

