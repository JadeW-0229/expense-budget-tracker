-- Approved emails are set only by the database maintainer, never by a browser.
create table expense_private.approved_admin_emails(email text primary key check(email=lower(email)));
alter table expense_private.approved_admin_emails enable row level security;
revoke all on expense_private.approved_admin_emails from public,anon,authenticated;

create function expense_private.provision_approved_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email_confirmed_at is not null and exists
    (select 1 from expense_private.approved_admin_emails where email=lower(new.email)) then
    insert into expense_private.admins(user_id) values(new.id) on conflict do nothing;
  else
    delete from expense_private.admins where user_id=new.id;
  end if;
  return new;
end;
$$;
revoke all on function expense_private.provision_approved_admin() from public,anon,authenticated;
create trigger expense_admin_user_provisioning
after insert or update of email,email_confirmed_at on auth.users
for each row execute function expense_private.provision_approved_admin();
