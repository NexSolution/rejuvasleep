# RejuvaSleep

Sleep + natural anti-aging membership. Live at https://nexsolution.github.io/rejuvasleep/

## Pages
- `index.html` — landing page
- `quiz.html` — Sleep Aging Quiz → score, triggers, plan preview, offer
- `login.html` — create account, log in, reset password
- `app.html` — member area: Today, Track (free) · My plan, Face rituals, Learn (members)

## Settings
`js/config.js` — PayPal link, price, Supabase URL and public key.

## Database (Supabase)
`supabase/SETUP.sql` — paste into Supabase → SQL Editor → Run. Creates profiles, memberships, sleep/water/ritual logs and the members-only library, all with row-level security.

## Giving someone access
Until the PayPal webhook is connected, add buyers by hand: Supabase → Table Editor → `memberships` → Insert row → `email` = the email they paid with. They unlock instantly (they can tap "Check again" in the app).

## Adding a video
Table Editor → `library` → Insert row: `slug` (e.g. `gua-sha-video`), `kind` = `video`, `title`, `summary`, `video_url` = YouTube link.
