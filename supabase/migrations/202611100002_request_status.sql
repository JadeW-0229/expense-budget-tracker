-- Read-only acknowledgement lookup after an HTTP response is lost.
create function public.expense_request_status(p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not expense_private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if exists(select 1 from expense_private.audit_log where request_id=p_request_id and actor=auth.uid()) then
    return jsonb_build_object('committed',true,'snapshot',public.expense_snapshot());
  end if;
  return jsonb_build_object('committed',false);
end;
$$;
revoke all on function public.expense_request_status(uuid) from public,anon,authenticated;
grant execute on function public.expense_request_status(uuid) to authenticated;
