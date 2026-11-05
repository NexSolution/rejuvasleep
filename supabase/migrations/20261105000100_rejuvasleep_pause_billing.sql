-- When a member pauses, their PayPal billing is paused too until this date
alter table public.memberships add column if not exists paused_until date;

-- Hourly job: restart billing for pauses that have reached their restart date
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('rejuvasleep-resume-paused') where exists (select 1 from cron.job where jobname = 'rejuvasleep-resume-paused');
select cron.schedule(
  'rejuvasleep-resume-paused',
  '5 * * * *',
  $$ select net.http_post(
       url := 'https://ufgsbldkedtguscfdkvg.supabase.co/functions/v1/resume-due',
       headers := '{"content-type":"application/json"}'::jsonb,
       body := '{}'::jsonb
     ) $$
);
