# Golden Baccarat

Static frontend for the Golden Baccarat prototype. The entry, baccarat table, mini-game, and lounge are separate pages. Navigation between game pages goes through the entry lobby. Deploy the contents of this folder from the repository root (for example, with GitHub Pages).

## Included

- Baccarat with chip bets, slow sequential card dealing, Punto Banco third-card rules and payouts.
- 20-column x 6-row result road with P/B/T as equal outcomes, streaks flowing down and along the bottom row, and reset after column 20.
- Mini-game hall with a quick-tap button that awards 500 virtual chips per tap and a 30-second Chip Catcher that awards 700 chips immediately for each catch. Both feed the baccarat bankroll.
- House and character cosmetic purchases using chips; baccarat rounds add fame toward player tiers.
- Local friend list; global rankings and live friend connections are marked for later backend integration.
- PWA manifest and service worker scaffolding.

## Online play status

GitHub Pages hosts the static game. The Supabase setup in `supabase-schema.sql` adds saved accounts, shared rooms, room membership, realtime room updates, and shared baccarat results. Until a Supabase project is connected in `supabase-config.js` and the SQL is run, the live site stays in local-demo mode.


## Account signup, username login, cloud saves, and online rooms

Signup asks for email, password, and a unique login ID (3–20 lowercase English letters, digits, or underscores). Login asks for the ID and password. The game nickname is a separate field. Supabase Auth still verifies the password against the registered email behind the scenes.

To activate accounts and cloud saves:

1. Create a Supabase project and run `supabase-schema.sql` in its SQL Editor.
2. In `supabase-config.js`, set the project URL and publishable (or legacy anon) key. These are the only keys that belong in browser code.
3. Add the GitHub Pages site URL to Supabase Auth's Site URL and redirect URL settings.
4. Install the Supabase CLI, link this project, and deploy `supabase/functions/username-login` with `supabase/config.toml` from this folder. Set `SUPABASE_SERVICE_ROLE_KEY` as an Edge Function secret; never put it in `supabase-config.js` or any browser file. The function uses the project's `SUPABASE_URL` and its public anon/publishable key.
5. In Supabase Auth, add the GitHub Pages URL to the allowed site and redirect URLs. Enable email confirmation if you want verified email addresses before first login.

The database trigger creates a private ID-to-account mapping, and the public login function returns only a normal Supabase sign-in session. Cloud saves are restricted to each signed-in player's own account. Room creation, joining, host election, stale-member cleanup, and round updates go through authenticated database functions; Realtime row subscriptions are limited to room members. The login and game buttons remain in local-demo mode until the project keys, SQL, and function are configured.

