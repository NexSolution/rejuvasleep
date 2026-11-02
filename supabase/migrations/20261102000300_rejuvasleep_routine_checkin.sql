-- Rounds of the 21-day reset, day-21 check-ins, daily routine ticks, guided ritual steps

alter table public.profiles
  add column if not exists program_start date,
  add column if not exists program_round int not null default 1,
  add column if not exists prev_quiz_score int;

create table if not exists public.checkins (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  round int not null,
  score_before int,
  score_after int,
  reasons text[] not null default '{}',
  note text,
  choice text check (choice in ('continue','finish')),
  created_at timestamptz not null default now(),
  unique (user_id, round)
);

create table if not exists public.routine_checks (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  log_date date not null,
  item text not null,
  unique (user_id, log_date, item)
);

do $$
declare t text;
begin
  foreach t in array array['checkins','routine_checks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- Guided steps: [{title, text, reps, beat, seconds, image}]
--   reps × beat = a rhythm counter (one stroke per beat); seconds = a simple timer
alter table public.library add column if not exists steps jsonb;

update public.library set steps = '[
 {"title":"Prepare","text":"Cleanse your face, then smooth a generous layer of face oil over your face and neck so the tool glides.","seconds":30},
 {"title":"Neck · left side","text":"Hold the tool almost flat. Sweep gently down from your jaw to your collarbone.","reps":5,"beat":3},
 {"title":"Neck · right side","text":"Same on the right: jaw down to collarbone, slow and light.","reps":5,"beat":3},
 {"title":"Jaw · left side","text":"Use the notched edge. Glide from the centre of your chin out along the jaw to your ear.","reps":5,"beat":3},
 {"title":"Jaw · right side","text":"Chin to ear along the right jaw.","reps":5,"beat":3},
 {"title":"Cheek · left side","text":"Long edge from beside your nose, across the cheek, out to your ear.","reps":5,"beat":3},
 {"title":"Cheek · right side","text":"Nose to ear across the right cheek.","reps":5,"beat":3},
 {"title":"Under-eye · left","text":"Smallest curve, feather-light. Inner corner outward to the temple.","reps":3,"beat":3},
 {"title":"Under-eye · right","text":"Feather-light, inner corner to temple.","reps":3,"beat":3},
 {"title":"Forehead","text":"From your brows up to the hairline, then out toward the temples.","reps":5,"beat":3},
 {"title":"Finish","text":"Three slow sweeps down each side of the neck to drain. Then wash the tool with soap and water.","reps":3,"beat":3}
]'::jsonb where slug = 'gua-sha';

update public.library set steps = '[
 {"title":"Warm up","text":"Warm 2–3 drops of face oil or moisturiser between your fingertips.","seconds":15},
 {"title":"Neck first","text":"Stroke down both sides of your neck from ears to collarbone.","reps":5,"beat":3},
 {"title":"Jaw","text":"With your knuckles, glide from your chin out along your jaw to your ears.","reps":5,"beat":3},
 {"title":"Cheeks","text":"Fingertips press from the sides of your nose out toward your ears.","reps":5,"beat":3},
 {"title":"Under-eyes","text":"Ring finger, very light taps from the inner corner outward.","reps":10,"beat":1},
 {"title":"Forehead","text":"Palms sweep from the centre of your forehead out to your temples.","reps":5,"beat":3},
 {"title":"Drain","text":"Three more slow strokes down your neck.","reps":3,"beat":3}
]'::jsonb where slug = 'face-massage';

update public.library set steps = '[
 {"title":"Prepare","text":"Fill a bowl with cold water and a handful of ice. Tie your hair back and wash your face.","seconds":60},
 {"title":"Dip 1","text":"Breathe in, then dip your face into the water. Come up when the timer ends.","seconds":10},
 {"title":"Breathe","text":"Rest and breathe normally.","seconds":15},
 {"title":"Dip 2","text":"Breathe in and dip again.","seconds":10},
 {"title":"Breathe","text":"Rest and breathe normally.","seconds":15},
 {"title":"Dip 3","text":"Last dip.","seconds":10},
 {"title":"Finish","text":"Pat dry with a clean towel and apply moisturiser.","seconds":20}
]'::jsonb where slug = 'ice-dip';

update public.library set steps = '[
 {"title":"Prepare","text":"Take the cucumber and 2 spoons from the fridge. Cut two thick slices.","seconds":60},
 {"title":"Rest with cucumber","text":"Lie back with the slices over your closed eyes. Breathe slowly.","seconds":600},
 {"title":"Cold spoons","text":"Press the rounded back of each spoon gently under your eyes, rolling outward to your temples.","seconds":60},
 {"title":"Finish","text":"Tap in a little eye cream or moisturiser with your ring finger.","seconds":20}
]'::jsonb where slug = 'cucumber-eyes';
