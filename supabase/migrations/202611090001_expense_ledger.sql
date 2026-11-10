-- Independent expense project. No objects from the reimbursement guide are used.
begin;
create schema if not exists expense_private;
revoke all on schema expense_private from public, anon, authenticated;

create table expense_private.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table expense_private.ledger (
  id boolean primary key default true check(id),
  version bigint not null default 1,
  catalog jsonb not null,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
create table expense_private.audit_log (
  id bigint generated always as identity primary key,
  actor uuid references auth.users(id),
  request_id uuid unique,
  version bigint not null,
  previous_state jsonb not null,
  next_state jsonb not null,
  created_at timestamptz not null default now()
);
alter table expense_private.admins enable row level security;
alter table expense_private.ledger enable row level security;
alter table expense_private.audit_log enable row level security;
revoke all on all tables in schema expense_private from public, anon, authenticated;

create function expense_private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from expense_private.admins where user_id = auth.uid());
$$;

create function public.expense_snapshot() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  select jsonb_build_object('version',version,'catalog',catalog,'state',state,
    'canAdmin',expense_private.is_admin(),'updatedAt',updated_at)
  into result from expense_private.ledger where id=true;
  if result is null then raise exception 'LEDGER_NOT_INITIALIZED'; end if;
  return result;
end;
$$;

create function expense_private.amount_used(s jsonb, catalog jsonb, g text, c integer)
returns numeric language sql stable set search_path = '' as $$
  select coalesce(sum((r->>'incurred')::numeric),0)
  from jsonb_array_elements(s->'records') r
  where r->>'group'=g and (r->>'category')::integer=c and
    (c=12 or coalesce((r->>'budgetReserved')::boolean,false) or r->>'origin'='manual'
      or r->>'id' like 'local-%' or
      (coalesce(r->>'date','')<>'' and r->>'date'>=coalesce(s->'startDates'->>g,catalog->'defaultStartDates'->>g)));
$$;

create function public.expense_commit(p_version bigint, p_state jsonb, p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  existing expense_private.ledger%rowtype;
  proposed jsonb;
  records_normalized jsonb := '[]'::jsonb;
  r jsonb; prior jsonb; b jsonb; g text; c integer; from_date text;
  allocated numeric; before_used numeric; after_used numeric;
  financially_changed boolean; count_records integer;
begin
  if not expense_private.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  select * into existing from expense_private.ledger where id=true for update;
  if not found then raise exception 'LEDGER_NOT_INITIALIZED'; end if;
  if p_request_id is not null and exists(select 1 from expense_private.audit_log where request_id=p_request_id and actor=auth.uid()) then
    return public.expense_snapshot();
  end if;
  if existing.version<>p_version then raise exception 'VERSION_CONFLICT'; end if;
  if jsonb_typeof(p_state->'records') is distinct from 'array'
    or jsonb_typeof(p_state->'budgets') is distinct from 'array'
    or jsonb_typeof(p_state->'startDates') is distinct from 'object'
    or jsonb_typeof(p_state->'deletedRecords') is distinct from 'array' then
    raise exception 'INVALID_STATE';
  end if;
  proposed=jsonb_build_object('records',p_state->'records','budgets',p_state->'budgets',
    'startDates',p_state->'startDates','deletedRecords',p_state->'deletedRecords',
    'sourceRevision',existing.state->'sourceRevision');
  count_records=jsonb_array_length(proposed->'records');
  if count_records>20000 or count_records<>(select count(distinct x->>'id') from jsonb_array_elements(proposed->'records') x) then
    raise exception 'DUPLICATE_OR_TOO_MANY_RECORDS';
  end if;
  for g in select jsonb_array_elements_text(existing.catalog->'groups') loop
    from_date=coalesce(proposed->'startDates'->>g,existing.catalog->'defaultStartDates'->>g);
    if from_date is null or from_date !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'INVALID_START_DATE'; end if;
    perform from_date::date;
  end loop;
  if exists(select 1 from jsonb_object_keys(proposed->'startDates') k
    where not (existing.catalog->'groups' ? k)) then raise exception 'INVALID_GROUP'; end if;

  if jsonb_array_length(proposed->'budgets')<>
    jsonb_array_length(existing.catalog->'groups')*jsonb_array_length(existing.catalog->'categories') then
    raise exception 'INVALID_BUDGET_COUNT';
  end if;
  if (select count(distinct (x->>'group',x->>'category')) from jsonb_array_elements(proposed->'budgets') x)
    <>jsonb_array_length(proposed->'budgets') then raise exception 'DUPLICATE_BUDGET'; end if;
  for b in select value from jsonb_array_elements(proposed->'budgets') loop
    if not (existing.catalog->'groups' ? (b->>'group')) or not exists
      (select 1 from jsonb_array_elements(existing.catalog->'categories') x where x->>'id'=b->>'category')
      or jsonb_typeof(b->'amount') is distinct from 'number' then raise exception 'INVALID_BUDGET'; end if;
    allocated=(b->>'amount')::numeric;
    if allocated<0 or allocated<>round(allocated,2) or allocated>100000000000 then raise exception 'INVALID_BUDGET_AMOUNT'; end if;
  end loop;

  for r in select value from jsonb_array_elements(proposed->'records') loop
    if coalesce(r->>'id','')='' or jsonb_typeof(r->'incurred') is distinct from 'number'
      or jsonb_typeof(r->'reimbursed') is distinct from 'number'
      or not exists(select 1 from jsonb_array_elements(existing.catalog->'categories') x where x->>'id'=r->>'category') then
      raise exception 'INVALID_RECORD';
    end if;
    if (r->>'incurred')::numeric<>round((r->>'incurred')::numeric,2)
      or (r->>'reimbursed')::numeric<>round((r->>'reimbursed')::numeric,2)
      or abs((r->>'incurred')::numeric)>100000000000
      or abs((r->>'reimbursed')::numeric)>100000000000 then raise exception 'INVALID_AMOUNT_PRECISION'; end if;
    select value into prior from jsonb_array_elements(existing.state->'records') where value->>'id'=r->>'id';
    financially_changed=prior is null or
      (r->>'group',r->>'category',r->>'date',r->>'incurred') is distinct from
      (prior->>'group',prior->>'category',prior->>'date',prior->>'incurred');
    if financially_changed or r->'reimbursed' is distinct from prior->'reimbursed' then
      if not (existing.catalog->'groups' ? (r->>'group')) then raise exception 'INVALID_RECORD_GROUP'; end if;
      if coalesce(r->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'INVALID_RECORD_DATE'; end if;
      perform (r->>'date')::date;
      if (r->>'incurred')::numeric<0 or (r->>'reimbursed')::numeric<0
        or (r->>'reimbursed')::numeric>(r->>'incurred')::numeric then raise exception 'INVALID_RECORD_AMOUNT'; end if;
    end if;
    if prior is null then
      if r->>'id' not like 'local-%' or coalesce(trim(r->>'requester'),'')=''
        or coalesce(trim(r->>'purpose'),'')='' or (r->>'incurred')::numeric<=0 then raise exception 'INVALID_NEW_RECORD'; end if;
      r=r||jsonb_build_object('origin','manual','source','雲端新增');
    else
      -- Client cannot erase a manual record's reservation by editing metadata.
      r=r||jsonb_build_object('origin',coalesce(prior->>'origin','excel'),'source',prior->'source');
    end if;
    r=r||jsonb_build_object('budgetReserved',financially_changed or coalesce((prior->>'budgetReserved')::boolean,false)
      or prior->>'origin'='manual' or r->>'id' like 'local-%');
    if (r->>'category')::integer=12 then
      r=r||jsonb_build_object('group','教學部','department','教學部');
    elsif financially_changed then
      r=r||jsonb_build_object('department',r->>'group');
    end if;
    records_normalized=records_normalized||jsonb_build_array(r);
  end loop;
  proposed=jsonb_set(proposed,'{records}',records_normalized);
  -- Check each bucket against its final occupancy, within this row lock/transaction.
  -- Pre-existing imported overspending may be reduced or corrected, never increased.
  for b in select value from jsonb_array_elements(proposed->'budgets') loop
    g=b->>'group';c=(b->>'category')::integer;allocated=(b->>'amount')::numeric;
    before_used=expense_private.amount_used(existing.state,existing.catalog,g,c);
    after_used=expense_private.amount_used(proposed,existing.catalog,g,c);
    if after_used>allocated and after_used>before_used then
      raise exception 'BUDGET_EXCEEDED' using detail=jsonb_build_object('group',g,'category',c,
        'allocated',allocated,'current',before_used,'projected',after_used)::text;
    end if;
  end loop;
  insert into expense_private.audit_log(actor,request_id,version,previous_state,next_state)
    values(auth.uid(),p_request_id,existing.version+1,existing.state,proposed);
  update expense_private.ledger set state=proposed,version=existing.version+1,updated_at=now() where id=true;
  return public.expense_snapshot();
end;
$$;

revoke all on all functions in schema expense_private from public,anon,authenticated;
revoke all on function public.expense_snapshot() from public,anon,authenticated;
revoke all on function public.expense_commit(bigint,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.expense_snapshot() to anon,authenticated;
grant execute on function public.expense_commit(bigint,jsonb,uuid) to authenticated;
commit;
