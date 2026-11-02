-- RejuvaSleep: full database setup. Paste this whole file into Supabase → SQL Editor → Run.
-- Safe to run more than once.

-- RejuvaSleep database setup
-- Safe to run more than once.

-- ── Profiles: one row per user ─────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text,
  quiz jsonb,
  quiz_score int,
  wake_time time not null default '06:30',
  sleep_goal_hours numeric(3,1) not null default 7.5,
  water_goal int not null default 8,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own" on public.profiles
  for select using (id = auth.uid());

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Create a profile automatically when someone signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Memberships: who has paid ──────────────────────────────
-- Keyed by email so you can add a buyer before or after they sign up.
-- Only you (dashboard) or the PayPal webhook can add rows. Users can only read their own.
create table if not exists public.memberships (
  email text primary key,
  plan text not null default 'lifetime',
  source text not null default 'manual',
  paypal_ref text,
  created_at timestamptz not null default now()
);

alter table public.memberships enable row level security;

drop policy if exists "memberships: read own" on public.memberships;
create policy "memberships: read own" on public.memberships
  for select using (lower(email) = lower(auth.jwt() ->> 'email'));

create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships
    where lower(email) = lower(auth.jwt() ->> 'email')
  );
$$;

-- ── Sleep log: one entry per night ─────────────────────────
create table if not exists public.sleep_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  log_date date not null,
  bedtime time not null,
  wake_time time not null,
  hours numeric(4,2) not null,
  quality int check (quality between 1 and 5),
  note text,
  created_at timestamptz not null default now(),
  unique (user_id, log_date)
);

-- ── Water log: one entry per day ───────────────────────────
create table if not exists public.water_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  log_date date not null,
  glasses int not null default 0 check (glasses between 0 and 30),
  coconut int not null default 0 check (coconut between 0 and 10),
  unique (user_id, log_date)
);

-- ── Ritual log: face rituals done each day ─────────────────
create table if not exists public.ritual_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  log_date date not null,
  ritual text not null,
  unique (user_id, log_date, ritual)
);

-- Same rule for all three logs: you only ever see and change your own rows
do $$
declare t text;
begin
  foreach t in array array['sleep_logs','water_logs','ritual_logs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- RejuvaSleep members-only library (rituals, articles, videos)
-- Safe to run more than once. Edit content any time in Table Editor → library.

create table if not exists public.library (
  slug text primary key,
  kind text not null check (kind in ('ritual','article','video')),
  title text not null,
  summary text not null default '',
  minutes int,
  time_of_day text,              -- 'morning' | 'evening' | 'anytime'
  targets text[] default '{}',   -- skin concerns this helps: puffy, dark, dull, lines, breakouts
  body text not null default '', -- simple HTML
  video_url text,                -- YouTube link for videos
  sort int not null default 100,
  published boolean not null default true
);

alter table public.library enable row level security;

drop policy if exists "library: members read" on public.library;
create policy "library: members read" on public.library
  for select using (published and public.is_member());

insert into public.library (slug, kind, title, summary, minutes, time_of_day, targets, sort, body) values

('ice-dip','ritual','Ice-water face dip','Brings morning puffiness down fast and wakes your skin up.',2,'morning','{puffy,dull}',10,
$$<ol>
<li>Fill a clean bowl with cold water and a handful of ice cubes. Let it sit for a minute.</li>
<li>Tie your hair back and wash your face with a gentle cleanser.</li>
<li>Take a breath and dip your face in for <strong>10 seconds</strong>. Come up and breathe.</li>
<li>Repeat 3 times, or until you've done about 30 seconds total.</li>
<li>Pat dry with a clean towel and follow with moisturiser.</li>
</ol>
<p><strong>Go gentle:</strong> never hold ice directly on your skin for long. Skip this if you have rosacea, broken skin or get headaches from cold. If dipping feels too much, wrap ice in a thin cloth and press it under your eyes for a few seconds at a time.</p>$$),

('cucumber-eyes','ritual','Cucumber & cold-spoon eye reset','Cools and calms puffy, tired-looking under-eyes.',10,'morning','{puffy,dark}',20,
$$<ol>
<li>The night before, put 2 metal spoons and a cucumber in the fridge.</li>
<li>In the morning, cut two thick cucumber slices.</li>
<li>Lie back and place the slices over your closed eyes for <strong>10 minutes</strong>.</li>
<li>Swap to the cold spoons: press the rounded back gently under each eye, rolling outward toward your temples, for 1 minute.</li>
<li>Finish with an eye cream or a light moisturiser, tapping it in with your ring finger.</li>
</ol>
<p>Cold helps shrink puffiness for a few hours. Dark circles that stay all day are often about sleep length and genetics, so pair this with your bedtime plan.</p>$$),

('face-massage','ritual','Morning lymphatic face massage','Three minutes to boost circulation and bring back your glow.',3,'morning','{puffy,dull}',30,
$$<ol>
<li>Warm 2–3 drops of face oil or moisturiser between your fingers.</li>
<li><strong>Neck first:</strong> stroke down both sides of your neck from ears to collarbone, 5 times. This opens the path for fluid to drain.</li>
<li><strong>Jaw:</strong> with your knuckles, glide from your chin out along your jaw to your ears, 5 times.</li>
<li><strong>Cheeks:</strong> fingertips press from the sides of your nose out toward your ears, 5 times.</li>
<li><strong>Under-eyes:</strong> ring finger, very light taps from inner corner outward, 10 taps.</li>
<li><strong>Forehead:</strong> palms sweep from the centre out to your temples, 5 times.</li>
<li>End with 3 more strokes down your neck.</li>
</ol>
<p>Pressure should feel like stroking a cat. Light is better here.</p>$$),

('gua-sha','ritual','Evening gua sha','Releases jaw and forehead tension and smooths the look of skin before bed.',5,'evening','{lines,puffy,dull}',40,
$$<ol>
<li>Cleanse, then apply a generous layer of face oil so the tool glides. It should never drag.</li>
<li>Hold the gua sha almost <strong>flat against your skin</strong> (about 15°).</li>
<li><strong>Neck:</strong> sweep downward from jaw to collarbone, 5 times each side.</li>
<li><strong>Jaw:</strong> use the notched edge from chin to ear, 5 times each side.</li>
<li><strong>Cheeks:</strong> long edge from beside your nose out to your ear, 5 times.</li>
<li><strong>Under-eyes:</strong> smallest curve, feather-light, inner corner outward, 3 times.</li>
<li><strong>Forehead:</strong> from brows up to hairline, then out to temples, 5 times.</li>
<li>Wipe the tool clean with soap and water after every use.</li>
</ol>
<p><strong>Go gentle:</strong> light pressure only. Skip any area with active breakouts, cuts or irritation. A little pinkness is normal; bruising means too much pressure.</p>$$),

('hydration','ritual','Water & coconut-water routine','Hydrate in a way that helps your skin without waking you up at night.',1,'anytime','{dull,lines}',50,
$$<ul>
<li><strong>On waking:</strong> one full glass of water before coffee or tea.</li>
<li><strong>Morning to 3pm:</strong> this is when to drink most of your daily target. Keep a bottle where you can see it.</li>
<li><strong>Coconut water:</strong> one glass after exercise or on hot days. It brings potassium and electrolytes, but it has natural sugar, so one serving is plenty.</li>
<li><strong>After 7pm:</strong> small sips only, and stop about an hour before bed so you're not up at 3am.</li>
<li><strong>Easy wins:</strong> cucumber, watermelon, oranges and soups all count toward hydration.</li>
</ul>
<p>Log your glasses in the tracker each day. Your weekly tips will tell you if you're falling short.</p>$$),

('skin-friendly-sleep','ritual','Skin-friendly sleep setup','Small bedroom changes that protect your skin while you sleep.',5,'evening','{lines,breakouts}',60,
$$<ul>
<li><strong>Silk or satin pillowcase:</strong> less friction on your skin and hair.</li>
<li><strong>Fresh pillowcase twice a week:</strong> oil and product build-up is a common cause of breakouts along the cheeks and jaw.</li>
<li><strong>Sleep on your back when you can:</strong> it avoids pressing your face into the pillow for hours.</li>
<li><strong>Humidifier if your air is dry:</strong> aim for 40–60% humidity so skin doesn't dry out overnight.</li>
<li><strong>Cool, dark room:</strong> around 65°F / 18°C with blackout curtains or an eye mask.</li>
<li><strong>Night skincare 1 hour before bed:</strong> so products absorb and don't end up on your pillow.</li>
</ul>$$),

('sleep-and-skin','article','How bad sleep shows up on your face','What actually happens to your skin when you cut sleep short.',4,null,'{}',110,
$$<p>Your skin does a lot of its repair work while you sleep. During deep sleep your body releases growth hormone, which helps rebuild tissue, including the collagen that keeps skin firm.</p>
<p>When sleep is short or broken, a few things happen:</p>
<ul>
<li><strong>Stress hormones stay higher.</strong> Cortisol is meant to drop at night. When it doesn't, it can break down collagen and trigger inflammation and breakouts.</li>
<li><strong>Fluid pools under your eyes.</strong> That's the morning puffiness and the shadowy look of dark circles.</li>
<li><strong>Skin loses more water.</strong> Tired skin holds moisture less well, so it looks dull and fine lines show more.</li>
</ul>
<p>Studies of people kept short on sleep consistently find they're rated as looking more tired and less healthy, and poor sleepers tend to show more signs of skin aging. The good news: these effects respond to better sleep. You don't need perfect nights, just more good ones than bad.</p>$$),

('wind-down','article','The 30-minute wind-down that works','A simple routine that trains your brain to switch off on cue.',3,null,'{}',120,
$$<p>Your brain doesn't have an off switch, but it does learn patterns. Doing the same few things in the same order every night teaches it that sleep is coming.</p>
<ol>
<li><strong>30 minutes before bed:</strong> phone on Do Not Disturb and out of reach. Dim the lights.</li>
<li><strong>25 minutes:</strong> skincare plus your evening ritual (gua sha or skin-friendly setup).</li>
<li><strong>15 minutes:</strong> warm caffeine-free tea such as chamomile. Write tomorrow's top 3 tasks and any worries on paper.</li>
<li><strong>5 minutes:</strong> in bed, do 4 rounds of 4-7-8 breathing: in through your nose for 4, hold for 7, out through your mouth for 8.</li>
</ol>
<p>Expect it to take 1–2 weeks before it feels automatic. Your tracker reminder will nudge you each night.</p>$$),

('cant-sleep','article','What to do when you can''t fall asleep','The 20-minute rule and why lying there fighting it backfires.',3,null,'{}',130,
$$<p>Lying in bed frustrated teaches your brain that bed is a place to be awake and stressed. Here's what to do instead:</p>
<ul>
<li><strong>Don't watch the clock.</strong> Turn it away. Checking the time makes you more alert.</li>
<li><strong>Use the 20-minute rule.</strong> If you feel wide awake for what seems like 20 minutes, get up. Sit somewhere dim and do something calm: read a paper book, fold laundry, stretch.</li>
<li><strong>Go back when you feel sleepy</strong>, not just tired. Repeat if you need to.</li>
<li><strong>Keep your wake time the same</strong> even after a bad night. Sleeping in pushes the problem to the next night.</li>
</ul>
<p>Resting quietly still has value, so try not to panic about lost sleep. The calmer you are about it, the faster it improves.</p>$$),

('caffeine-cutoff','article','Your caffeine cutoff','Why your 3pm coffee can still be in your system at bedtime.',2,null,'{}',140,
$$<p>Caffeine has a half-life of about 5 hours. That means half of a 3pm coffee can still be active at 8pm, and a quarter of it at 1am. Even if you fall asleep, your sleep tends to be lighter, so you spend less time in the deep stage where skin repair happens.</p>
<ul>
<li>Aim to have your <strong>last caffeine before noon</strong>, or at least 8 hours before bed.</li>
<li>Watch for hidden caffeine: black and green tea, cola, energy drinks, pre-workout and chocolate.</li>
<li>Afternoon swap ideas: coconut water, sparkling water with lime, rooibos or peppermint tea.</li>
</ul>$$),

('morning-light','article','Morning light: the free sleep fix','Why 10 minutes of daylight in the morning helps you sleep at night.',2,null,'{}',150,
$$<p>Your body clock sets itself mostly by light. Bright light early in the day tells your brain "it's morning," which starts a countdown to feeling sleepy about 14–16 hours later.</p>
<ul>
<li>Get <strong>10–20 minutes outside within an hour of waking</strong>. Cloudy days still count.</li>
<li>Combine it with something you already do: coffee on the porch, a short walk, the school run.</li>
<li>In the evening, do the opposite: dim lights and fewer screens after sunset.</li>
</ul>$$),

('see-a-doctor','article','When it''s more than habits','Signs your sleep problem needs a doctor, not just a routine.',2,null,'{}',160,
$$<p>Good habits fix a lot, but some sleep problems are medical. Talk to a doctor if you notice any of these:</p>
<ul>
<li>Loud snoring, gasping or choking at night, or someone tells you that you stop breathing</li>
<li>Feeling exhausted or falling asleep during the day even after 7–8 hours in bed</li>
<li>An urge to move your legs at night that keeps you awake</li>
<li>Trouble sleeping 3 or more nights a week for over 3 months</li>
<li>Low mood, anxiety or worry that's keeping you up</li>
</ul>
<p>Also check with a doctor or pharmacist before starting any sleep supplement, especially if you take other medication, are pregnant or have a health condition.</p>$$)

on conflict (slug) do update set
  kind = excluded.kind, title = excluded.title, summary = excluded.summary, minutes = excluded.minutes,
  time_of_day = excluded.time_of_day, targets = excluded.targets, sort = excluded.sort, body = excluded.body;
