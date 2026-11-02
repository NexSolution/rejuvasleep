-- The signup trigger runs on its own; nobody needs to call it through the API
revoke execute on function public.handle_new_user() from public, anon, authenticated;
-- Only signed-in users check their own membership
revoke execute on function public.is_member() from public, anon;
grant execute on function public.is_member() to authenticated;
