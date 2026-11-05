# RejuvaSleep

Sleep + natural anti-aging membership. Live at https://nexsolution.github.io/rejuvasleep/

## Pages
- `index.html` — landing page
- `quiz.html` — Sleep Aging Quiz → score, triggers, plan preview, offer
- `login.html` — create account, log in, reset password
- `app.html` — member area (after quiz + subscription): Today, Track, Rituals, Plan, Learn, Settings

## Settings
`js/config.js` — PayPal link, price, Supabase URL and public key.

## Database (Supabase)
`supabase/SETUP.sql` — paste into Supabase → SQL Editor → Run. Creates profiles, memberships, sleep/water/ritual logs and the members-only library, all with row-level security.

## Payments
Monthly subscription through PayPal: first month at the intro price, then the monthly price until cancelled.
- `js/config.js` → `paypalPlanId` (the plan's `P-…` ID), `introPrice`, `monthlyPrice`
- `supabase/functions/paypal-webhook` unlocks the account when PayPal confirms, keeps it active each month, and ends access on refund, suspension or expiry (cancelled subscriptions keep access until the paid month ends)
- Customers manage or cancel from Menu → "Manage or cancel subscription" (PayPal autopay page)

## Giving someone access by hand
Supabase → Table Editor → `memberships` → Insert row → `email` = their account email. With `plan` = `lifetime` they keep access forever.

## Adding a video
Table Editor → `library` → Insert row: `slug` (e.g. `gua-sha-video`), `kind` = `video`, `title`, `summary`, `video_url` = YouTube link.

## Plan rules
- Day 1 is the day the member first subscribed. Plans run in 21-day rounds that roll on automatically.
- Paused days (`pauses` table) don't count, so the round ends later. Every pause has a restart date up to 14 days away. Pausing also suspends PayPal billing (`manage-subscription` pause/resume); the hourly `resume-due` job restarts billing on the restart date, and the webhook ignores the SUSPENDED event for member pauses.
- Learn groups articles by a `topic:` tag in `library.targets` (`topic:positions`, `topic:practices`); untagged articles show under "Sleep and skin basics".
- Cancelling (Settings, or in PayPal) stops the plan right away: no more charges, history kept, no new entries. Restarting picks up on the same day.
- Billing wording follows `billingDays` in `js/config.js` (0 = monthly, 21 = every 21 days). Change it only when the PayPal plan matches.

## Functions
- `paypal-webhook` — PayPal events → memberships
- `manage-subscription` — signed-in member's own plan: status, cancel, pay an outstanding balance

## Shop

- `shop.html` is the public shop (anyone can buy). Members also get **Shop** and **My orders** in the app menu, plus a cart button in the header.
- Checkout runs through the `shop-checkout` edge function. Prices, shipping and country limits are worked out on the server from the `products` and `shop_settings` tables. PayPal shows a "Debit or Credit Card" button, so no PayPal account is needed.
- Order statuses: paid → ordered → shipped → delivered (or cancelled / refunded). Customers see a timeline and tracking link. Guests open their order with a private link (`shop.html#order/<id>/<token>`), which is also saved on their device.
- `admin.html` is the team page (emails in the `admins` table): orders to fulfil, copy address, supplier links, status and tracking, an "email the customer" button, products with photos and supplier costs, and shipping settings.
- Products have `blocked_countries` (ISO codes). The melatonin draft blocks countries where it is prescription-only or restricted — check with your supplier before changing it.
- The PayPal webhook marks shop orders paid (backup), refunded or denied, and never turns a shop payment into a membership.
- Add the webhook events `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.REVERSED` and `PAYMENT.CAPTURE.DENIED` in PayPal.
