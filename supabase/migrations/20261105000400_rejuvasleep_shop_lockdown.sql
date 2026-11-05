-- admin_orders only for signed-in users (it also checks is_admin inside)
revoke execute on function public.admin_orders(text) from anon;
