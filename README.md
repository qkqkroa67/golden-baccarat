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


## Account signup, username login, and cloud saves

Signup asks for email, password, and a unique login ID (3–20 lowercase English letters, digits, or underscores). Login asks for the ID and password. The game nickname is a separate field. Supabase Auth still verifies the password against the registered email behind the scenes.

To activate accounts and cloud saves:

1. Create a Supabase project and run `supabase-schema.sql` in its SQL Editor.
2. In `supabase-config.js`, set the project URL and publishable (or legacy anon) key. These are the only keys that belong in browser code.
3. Add the GitHub Pages site URL to Supabase Auth's Site URL and redirect URL settings.
4. Install the Supabase CLI, link this project, and deploy `supabase/functions/username-login` with `supabase/config.toml` from this folder. Set `SUPABASE_SERVICE_ROLE_KEY` as an Edge Function secret; never put it in `supabase-config.js` or any browser file. The function uses the project's `SUPABASE_URL` and its public anon/publishable key.

The database trigger creates a private ID-to-account mapping, and the public login function returns only the normal Supabase sign-in session. Cloud game saves stay protected by per-user row-level security. Until the project keys, SQL, and function are configured, the account buttons remain disabled.

