-- Build 35: non-destructive USD / UAH update. Existing sums remain UAH.
-- Atomic office save of the object card, technical data and string layout.
-- Apply after release34-base.sql, before private-storage.sql / field-project-sync.sql.
-- No client, object, warehouse, cash or attachment records are imported/deleted.
begin;
-- Existing numeric values remain UAH. Only new cards default to USD.
alter table public.projects add column if not exists currency text not null default 'UAH' check(currency in ('USD','UAH'));
alter table public.projects alter column currency set default 'USD';
alter table public.projects add column if not exists data_revision bigint not null default 0;

create or replace function public.sparta_project_write_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare company uuid;
begin
  if tg_table_name='projects' then
    company := new.company_id;
  else
    if tg_op='DELETE' then
      -- An authorized parent deletion already passed its RLS/role policy.
      if pg_trigger_depth()>1 then return old; end if;
      select p.company_id into company from public.projects p where p.id=old.project_id;
    else
      select p.company_id into company from public.projects p where p.id=new.project_id;
    end if;
  end if;
  if company is null or current_setting('sparta.project_write_company',true) is distinct from company::text then
    raise exception 'Use sparta_project_save or the authorized field/media RPC to change project data' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists sparta_project_atomic_guard on public.projects;
create trigger sparta_project_atomic_guard before insert or update on public.projects
for each row execute function public.sparta_project_write_guard();
drop trigger if exists sparta_technical_atomic_guard on public.project_technical;
create trigger sparta_technical_atomic_guard before insert or update or delete on public.project_technical
for each row execute function public.sparta_project_write_guard();
drop trigger if exists sparta_strings_atomic_guard on public.project_strings;
create trigger sparta_strings_atomic_guard before insert or update or delete on public.project_strings
for each row execute function public.sparta_project_write_guard();

create or replace function public.sparta_project_save(p_company_id uuid,p_payload jsonb,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  p jsonb := p_payload->'project';
  t jsonb := p_payload->'technical';
  s jsonb := p_payload->'strings';
  row public.projects%rowtype;
  part jsonb;
  field_name text;
  number_value numeric;
  client_key text;
begin
  if auth.uid() is null or not public.has_company_role(p_company_id,
    array['owner','admin','engineer','brigadier']::public.member_role[]) then
    raise exception 'Only active office staff may save object cards' using errcode='42501';
  end if;
  if p_expected_revision is null or p_expected_revision<0 then raise exception 'Missing project revision'; end if;
  if jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(t) is distinct from 'object' or
    jsonb_typeof(s) is distinct from 'array' or octet_length(p_payload::text)>2097152 or jsonb_array_length(s)>1000 then
    raise exception 'Invalid project payload';
  end if;
  if coalesce(p->>'currency','') not in ('USD','UAH') then raise exception 'Select project currency: USD or UAH'; end if;
  client_key := btrim(p->>'client_id');
  if coalesce(client_key,'')='' or length(client_key)>200 or coalesce(btrim(p->>'title'),'')='' then raise exception 'Project name and client identity are required'; end if;
  if p ? 'company_id' and p->>'company_id' is distinct from p_company_id::text then raise exception 'Project belongs to another company' using errcode='42501'; end if;
  if jsonb_typeof(p->'app_data') is distinct from 'object' or (p ? 'finance' and jsonb_typeof(p->'finance') is distinct from 'object') or
    jsonb_typeof(p->'work_checklist') is distinct from 'object' or jsonb_typeof(coalesce(p->'app_data'->'statusHistory','[]'::jsonb)) is distinct from 'array' then
    raise exception 'Invalid project metadata';
  end if;
  if exists(select 1 from jsonb_each(p->'work_checklist') x where jsonb_typeof(x.value)<>'boolean') then raise exception 'Checklist values must be boolean'; end if;
  if jsonb_typeof(coalesce(t->'equipment_details','{}'::jsonb)) is distinct from 'object' then raise exception 'Invalid equipment details'; end if;
  foreach field_name in array array['panel_power_w','panel_count','inverter_power_kw','mppt_count','pv_inputs_per_mppt','battery_capacity_kwh','battery_modules_count'] loop
    if jsonb_typeof(t->field_name) is distinct from 'number' then raise exception 'Invalid technical quantity %',field_name; end if;
    number_value := (t->>field_name)::numeric;
    if number_value<0 then raise exception 'Negative technical quantity %',field_name; end if;
    if field_name not in ('inverter_power_kw','battery_capacity_kwh') and number_value<>trunc(number_value) then raise exception 'Technical count must be an integer'; end if;
  end loop;
  for part in select value from jsonb_array_elements(s) loop
    if jsonb_typeof(part)<>'object' then raise exception 'Invalid string row'; end if;
    foreach field_name in array array['mppt_number','pv_input_number','string_number','panel_count','tilt_angle'] loop
      if jsonb_typeof(part->field_name) is distinct from 'number' then raise exception 'Invalid string quantity %',field_name; end if;
      number_value := (part->>field_name)::numeric;
      if number_value<0 or number_value<>trunc(number_value) or (field_name in ('mppt_number','pv_input_number','string_number') and number_value<1) or (field_name='tilt_angle' and number_value>90) then raise exception 'Invalid string quantity %',field_name; end if;
    end loop;
  end loop;
  perform set_config('sparta.project_write_company',p_company_id::text,true);
  -- The unique company/client key serializes concurrent creation too. A second
  -- creator must observe the first committed revision before making changes.
  insert into public.projects(company_id,client_id,title,currency,created_by)
    values(p_company_id,client_key,p->>'title',p->>'currency',auth.uid()) on conflict(company_id,client_id) do nothing;
  select * into row from public.projects where company_id=p_company_id and client_id=client_key for update;
  if row.currency is distinct from p->>'currency' then raise exception 'Project currency is fixed; do not relabel existing amounts'; end if;
  if row.data_revision<>p_expected_revision then raise exception 'Project changed on another device; reload before saving' using errcode='40001'; end if;
  if not public.has_company_role(p_company_id,array['owner','admin']::public.member_role[])
     and p ? 'finance' and p->'finance' is distinct from row.finance then
    raise exception 'Only owner or admin may change project finance' using errcode='42501';
  end if;
  if exists(select 1 from jsonb_array_elements(coalesce(p->'finance'->'offerLines','[]'::jsonb)) x where coalesce(x->>'currency',p->>'currency') is distinct from p->>'currency') then raise exception 'Offer currency must match project currency'; end if;
  update public.projects set
    title=p->>'title',client_name=coalesce(p->>'client_name',''),client_phone=coalesce(p->>'client_phone',''),
    address=coalesce(p->>'address',''),object_type=coalesce(p->>'object_type',''),status=(p->>'status')::public.project_status,
    installation_date=nullif(p->>'installation_date','')::date,team_name=coalesce(p->>'team_name',''),comment=coalesce(p->>'comment',''),
    app_data=jsonb_build_object('clientEmail',coalesce(p->'app_data'->>'clientEmail',''),'statusHistory',coalesce(p->'app_data'->'statusHistory','[]'::jsonb)),
    finance=coalesce(p->'finance',row.finance),work_checklist=p->'work_checklist',data_revision=data_revision+1
    where id=row.id returning * into row;
  insert into public.project_technical(project_id,panel_manufacturer,panel_model,panel_power_w,panel_count,panel_serial_numbers,
    inverter_manufacturer,inverter_model,inverter_power_kw,inverter_serial_number,mppt_count,pv_inputs_per_mppt,
    battery_manufacturer,battery_model,battery_capacity_kwh,battery_modules_count,battery_serial_numbers,equipment_details)
  values(row.id,coalesce(t->>'panel_manufacturer',''),coalesce(t->>'panel_model',''),(t->>'panel_power_w')::integer,(t->>'panel_count')::integer,coalesce(t->>'panel_serial_numbers',''),
    coalesce(t->>'inverter_manufacturer',''),coalesce(t->>'inverter_model',''),(t->>'inverter_power_kw')::numeric,coalesce(t->>'inverter_serial_number',''),(t->>'mppt_count')::integer,(t->>'pv_inputs_per_mppt')::integer,
    coalesce(t->>'battery_manufacturer',''),coalesce(t->>'battery_model',''),(t->>'battery_capacity_kwh')::numeric,(t->>'battery_modules_count')::integer,coalesce(t->>'battery_serial_numbers',''),coalesce(t->'equipment_details','{}'::jsonb))
  on conflict(project_id) do update set panel_manufacturer=excluded.panel_manufacturer,panel_model=excluded.panel_model,panel_power_w=excluded.panel_power_w,panel_count=excluded.panel_count,panel_serial_numbers=excluded.panel_serial_numbers,
    inverter_manufacturer=excluded.inverter_manufacturer,inverter_model=excluded.inverter_model,inverter_power_kw=excluded.inverter_power_kw,inverter_serial_number=excluded.inverter_serial_number,mppt_count=excluded.mppt_count,pv_inputs_per_mppt=excluded.pv_inputs_per_mppt,
    battery_manufacturer=excluded.battery_manufacturer,battery_model=excluded.battery_model,battery_capacity_kwh=excluded.battery_capacity_kwh,battery_modules_count=excluded.battery_modules_count,battery_serial_numbers=excluded.battery_serial_numbers,equipment_details=excluded.equipment_details;
  delete from public.project_strings where project_id=row.id;
  insert into public.project_strings(project_id,mppt_number,pv_input_number,string_number,string_type,panel_count,orientation,tilt_angle,note)
    select row.id,(x->>'mppt_number')::integer,(x->>'pv_input_number')::integer,(x->>'string_number')::integer,(x->>'string_type')::public.string_type,(x->>'panel_count')::integer,coalesce(x->>'orientation',''),(x->>'tilt_angle')::integer,coalesce(x->>'note','') from jsonb_array_elements(s) x;
  return jsonb_build_object('id',row.id,'dataRevision',row.data_revision);
end;
$$;
revoke all on function public.sparta_project_save(uuid,jsonb,bigint) from public;
grant execute on function public.sparta_project_save(uuid,jsonb,bigint) to authenticated;
commit;

-- SPARTA field: immutable cash journal (USD / UAH, integer minor units).
-- Run in Supabase SQL Editor after the existing company/project schema.
-- This migration creates structure and policies only; it does not import money.
-- Dependencies: public.companies, public.projects (company_id, client_id),
-- public.member_role, public.has_company_role(uuid, public.member_role[]), auth.uid().

begin;
alter table public.projects add column if not exists currency text not null default 'UAH' check(currency in ('USD','UAH'));
alter table public.projects alter column currency set default 'USD';

create table if not exists public.cash_transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_client_id text,
  project_title text not null default '',
  direction text not null check (direction in ('income', 'expense')),
  category text not null check (category in (
    'client_payment', 'client_refund', 'labor', 'materials',
    'other_income', 'other_expense', 'opening_balance'
  )),
  amount_minor bigint not null check (amount_minor between 1 and 9007199254740991),
  counterparty text not null check (length(btrim(counterparty)) > 0),
  purpose text not null check (length(btrim(purpose)) > 0),
  occurred_at timestamptz not null default now(),
  payment_method text not null default 'cash'
    check (payment_method in ('cash', 'bank', 'card')),
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  reverses_id uuid unique references public.cash_transactions(id),
  check (reverses_id is null or reverses_id <> id),
  check (project_client_id is null or length(btrim(project_client_id)) > 0),
  check (project_client_id is null or length(btrim(project_title)) > 0)
);

-- Adding the column preserves legacy rows without UPDATE of immutable history.
alter table public.cash_transactions add column if not exists currency text not null default 'UAH' check(currency in ('USD','UAH'));
-- Old clients must not silently post UAH amounts as USD.
alter table public.cash_transactions alter column currency drop default;

comment on table public.cash_transactions is
  'Append-only USD / UAH cash journal. Correct an entry by a linked opposite entry; never overwrite history.';
comment on column public.cash_transactions.amount_minor is
  'Positive amount in cents / kopiykas according to currency; direction supplies the sign. Limited to JavaScript safe integer range.';
comment on column public.cash_transactions.project_title is
  'Project name at entry creation; remains readable if the project is renamed or removed.';
comment on column public.cash_transactions.reverses_id is
  'One opposite entry cancels an original. A reversal cannot itself be reversed.';

create index if not exists cash_transactions_company_date_idx
  on public.cash_transactions (company_id, occurred_at desc, id);
create index if not exists cash_transactions_company_project_idx
  on public.cash_transactions (company_id, project_client_id);

create or replace function public.validate_cash_transaction()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  original public.cash_transactions%rowtype;
begin
  if auth.uid() is null or not public.has_company_role(
    new.company_id, array['owner', 'admin']::public.member_role[]
  ) then
    raise exception 'Only an active company owner or admin can post cash entries.'
      using errcode = '42501';
  end if;

  if new.currency is null or new.currency not in ('USD','UAH') then raise exception 'Select cash currency: USD or UAH'; end if;

  -- Audit identity/time come from the database, never from a browser payload.
  new.created_by := auth.uid();
  new.created_at := statement_timestamp();
  new.counterparty := btrim(new.counterparty);
  new.purpose := btrim(new.purpose);
  new.project_title := btrim(coalesce(new.project_title, ''));
  if new.project_client_id is not null then
    new.project_client_id := btrim(new.project_client_id);
  end if;

  if new.reverses_id is not null then
    select * into original
    from public.cash_transactions
    where id = new.reverses_id;

    if not found then
      raise exception 'Original cash entry was not found or is not accessible.';
    end if;
    if original.reverses_id is not null then
      raise exception 'A reversal cannot itself be reversed.';
    end if;
    if new.company_id is distinct from original.company_id
      or new.project_client_id is distinct from original.project_client_id
      or new.project_title is distinct from original.project_title
      or new.category is distinct from original.category
      or new.currency is distinct from original.currency
      or new.amount_minor is distinct from original.amount_minor
      or new.payment_method is distinct from original.payment_method
      or new.direction is distinct from (case original.direction
        when 'income' then 'expense' else 'income' end)
    then
      raise exception 'A reversal must preserve company, project, category, amount and payment method, with the opposite direction.';
    end if;

    -- The unique reverses_id constraint also prevents concurrent double reversals.
    -- A removed project may still be reversed using its original snapshot.
  else
    if (new.category in ('client_payment', 'other_income', 'opening_balance')
          and new.direction <> 'income')
      or (new.category in ('client_refund', 'labor', 'materials', 'other_expense')
          and new.direction <> 'expense')
    then
      raise exception 'Cash category does not match its direction.';
    end if;

    if new.project_client_id is not null and exists (select 1 from public.projects p where p.company_id=new.company_id and p.client_id=new.project_client_id and p.currency<>new.currency) then raise exception 'Cash currency must match project currency; currencies are accounted separately'; end if;
    if new.project_client_id is not null and not exists (
      select 1 from public.projects p
      where p.company_id = new.company_id
        and p.client_id = new.project_client_id
    ) then
      raise exception 'The selected project does not belong to this company or has not been synchronized.';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.reject_cash_transaction_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'Cash history is immutable. Post a linked reversal instead.'
    using errcode = '55000';
end;
$$;

revoke all on function public.validate_cash_transaction() from public, anon;
revoke all on function public.reject_cash_transaction_mutation() from public, anon;
grant execute on function public.validate_cash_transaction() to authenticated;
grant execute on function public.reject_cash_transaction_mutation() to authenticated;

drop trigger if exists cash_transactions_validate_insert on public.cash_transactions;
create trigger cash_transactions_validate_insert
before insert on public.cash_transactions
for each row execute function public.validate_cash_transaction();

-- Statement-level defense also covers TRUNCATE and API service-role writes.
drop trigger if exists cash_transactions_immutable on public.cash_transactions;
create trigger cash_transactions_immutable
before update or delete or truncate on public.cash_transactions
for each statement execute function public.reject_cash_transaction_mutation();

alter table public.cash_transactions enable row level security;

-- A restrictive guard keeps owner/admin scope even if another permissive
-- policy is added by a later migration.
drop policy if exists "cash company scope guard" on public.cash_transactions;
create policy "cash company scope guard"
on public.cash_transactions as restrictive for all to authenticated
using (public.has_company_role(company_id, array['owner', 'admin']::public.member_role[]))
with check (public.has_company_role(company_id, array['owner', 'admin']::public.member_role[]));

drop policy if exists "cash owners can read" on public.cash_transactions;
create policy "cash owners can read"
on public.cash_transactions for select to authenticated
using (public.has_company_role(company_id, array['owner', 'admin']::public.member_role[]));

drop policy if exists "cash owners can insert" on public.cash_transactions;
create policy "cash owners can insert"
on public.cash_transactions for insert to authenticated
with check (
  created_by = auth.uid()
  and public.has_company_role(company_id, array['owner', 'admin']::public.member_role[])
);

-- The browser has only append/read access. No update/delete policies exist.
revoke all on public.cash_transactions from public, anon, authenticated;
grant select, insert on public.cash_transactions to authenticated;
revoke update, delete, truncate, references, trigger on public.cash_transactions from service_role;

commit;

-- SPARTA: company-scoped warehouse, compare-and-swap posting and material snapshots.
-- Apply after the existing companies/projects/warehouse_items schema.
-- Does not import any browser data. Only existing company rows seed the first read.
begin;
alter table public.projects add column if not exists currency text not null default 'UAH' check(currency in ('USD','UAH'));
alter table public.projects alter column currency set default 'USD';

alter table public.warehouse_items add column if not exists app_data jsonb not null default '{}'::jsonb;
alter table public.project_materials add column if not exists app_data jsonb not null default '{}'::jsonb;
alter table public.warehouse_items alter column quantity type numeric(16,3);
alter table public.warehouse_items alter column min_quantity type numeric(16,3);
alter table public.project_materials alter column quantity type numeric(16,3);

create table if not exists public.warehouse_workspaces (
  company_id uuid primary key references public.companies(id),
  revision bigint not null default 0 check (revision >= 0),
  state jsonb not null,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
create table if not exists public.warehouse_requests (
  company_id uuid not null references public.companies(id),
  request_id uuid not null,
  revision bigint not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (company_id, request_id)
);
alter table public.warehouse_workspaces enable row level security;
alter table public.warehouse_requests enable row level security;
-- No direct browser writes: all writers lock one company row and check revision.
revoke all on public.warehouse_workspaces, public.warehouse_requests from anon, authenticated;

create or replace function public.sparta_warehouse_number(p_value jsonb)
returns numeric language plpgsql immutable set search_path = '' as $$
declare value_text text := coalesce(p_value #>> '{}', '0'); value_number numeric;
begin
  if value_text !~ '^-?[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' then
    raise exception 'Invalid warehouse number';
  end if;
  value_number := value_text::numeric;
  if abs(value_number) > 999999999999 then raise exception 'Warehouse number is too large'; end if;
  return value_number;
end $$;
revoke all on function public.sparta_warehouse_number(jsonb) from public;

create or replace function public.sparta_warehouse_legacy_state(p_company_id uuid)
returns jsonb language sql volatile security definer set search_path = '' as $$
  select jsonb_build_object('version', 1, 'items', coalesce(jsonb_agg(
    jsonb_build_object('id', w.client_item_id, 'name', w.name, 'category', w.category,
      'sku', coalesce(w.sku,''), 'unit', w.unit, 'qty', w.quantity,
      'purchasePrice', w.purchase_price, 'retailPrice', w.sale_price, 'salePrice', w.sale_price,
      'installerPrice', w.sale_price, 'deliveryCost', 0, 'extraCost', 0,
      'minQty', w.min_quantity, 'location', coalesce(w.location,'')) || w.app_data
    order by w.created_at, w.id) filter (where w.id is not null), '[]'::jsonb),
    'movements', '[]'::jsonb, 'documents', '[]'::jsonb, 'reservations', '[]'::jsonb)
  from public.warehouse_items w where w.company_id = p_company_id;
$$;
revoke all on function public.sparta_warehouse_legacy_state(uuid) from public;

create or replace function public.sparta_warehouse_materials(p_project_id uuid)
returns jsonb language sql volatile security definer set search_path = '' as $$
  select jsonb_build_object('token', md5(coalesce(jsonb_agg(to_jsonb(m) order by m.id), '[]'::jsonb)::text),
    'materials', coalesce(jsonb_agg(case when m.app_data <> '{}'::jsonb then m.app_data else
      jsonb_build_object('category', m.category, 'name', m.name, 'unit', m.unit,
        'plannedQty', m.quantity, 'issuedQty', m.quantity, 'actualQty', m.quantity,
        'warehouseItemId', '', 'purchasePriceSnapshot', 0, 'salePriceSnapshot', 0) end
      order by m.created_at, m.id), '[]'::jsonb))
  from public.project_materials m where m.project_id = p_project_id;
$$;
revoke all on function public.sparta_warehouse_materials(uuid) from public;

create or replace function public.sparta_warehouse_read(p_company_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare result_state jsonb; result_revision bigint;
begin
  if auth.uid() is null or not public.has_company_role(p_company_id,
    array['owner','admin','warehouse','engineer','brigadier','installer','viewer']::public.member_role[]) then
    raise exception 'Active staff membership required' using errcode = '42501';
  end if;
  select state, revision into result_state, result_revision
    from public.warehouse_workspaces where company_id = p_company_id;
  return jsonb_build_object('revision', coalesce(result_revision,0),
    'state', coalesce(result_state, public.sparta_warehouse_legacy_state(p_company_id)),
    'projectMaterials', (select coalesce(jsonb_agg(jsonb_build_object('id',p.client_id)
      || public.sparta_warehouse_materials(p.id) order by p.client_id), '[]'::jsonb)
      from public.projects p where p.company_id = p_company_id));
end $$;
revoke all on function public.sparta_warehouse_read(uuid) from public;
grant execute on function public.sparta_warehouse_read(uuid) to authenticated;

create or replace function public.sparta_warehouse_write(
  p_company_id uuid, p_request_id uuid, p_expected_revision bigint,
  p_state jsonb, p_project_updates jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  current_row public.warehouse_workspaces%rowtype;
  entry jsonb; previous_entry jsonb; movement jsonb; update_entry jsonb; material jsonb;
  project_row public.projects%rowtype;
  old_materials jsonb; fresh_materials jsonb;
  item_id text; project_client_id text; old_qty numeric; new_qty numeric;
  delta_qty numeric; reserved_qty numeric; issued_delta numeric; actual_delta numeric;
  expected_issued numeric; expected_actual numeric; number_value numeric;
  cost_delta numeric; sale_delta numeric; expected_cost numeric; expected_sale numeric;
  old_unit_cost numeric; inventory_value numeric; movement_cost numeric; old_issued numeric;
  old_material_cost numeric; old_material_sale numeric;
  field_name text; collection_name text; incoming_ids text[];
begin
  if auth.uid() is null or not public.has_company_role(p_company_id,
    array['owner','admin','warehouse','engineer','brigadier']::public.member_role[]) then
    raise exception 'Only an active company owner, admin or warehouse worker can post warehouse documents' using errcode = '42501';
  end if;
  if p_request_id is null or p_expected_revision is null then raise exception 'Missing request identity'; end if;
  if jsonb_typeof(p_state) <> 'object' or jsonb_typeof(p_project_updates) <> 'array'
     or octet_length(p_state::text) > 10000000 then raise exception 'Invalid warehouse payload'; end if;

  insert into public.warehouse_workspaces(company_id, state)
    values(p_company_id, public.sparta_warehouse_legacy_state(p_company_id)) on conflict do nothing;
  select * into current_row from public.warehouse_workspaces where company_id = p_company_id for update;
  -- A retry after a lost response never posts a second document.
  if exists(select 1 from public.warehouse_requests where company_id=p_company_id and request_id=p_request_id) then
    return public.sparta_warehouse_read(p_company_id);
  end if;
  if current_row.revision <> p_expected_revision then
    raise exception 'Warehouse revision changed; reload before posting' using errcode = '40001';
  end if;
  if not public.has_company_role(p_company_id,array['owner','admin','warehouse']::public.member_role[]) and p_state is distinct from current_row.state then
    raise exception 'Only owner, admin or warehouse worker can change stock documents; office staff may edit material plans only' using errcode='42501';
  end if;
  -- Browser-supplied historical dates are document dates; audit actor/time are
  -- always assigned by PostgreSQL for newly posted entries.
  foreach collection_name in array array['movements','documents'] loop
    p_state := jsonb_set(p_state,array[collection_name],coalesce((select jsonb_agg(
      case when exists(select 1 from jsonb_array_elements(current_row.state->collection_name) o where o->>'id'=x.value->>'id' and (collection_name='movements' or o->>'status'<>'draft')) then x.value
      else x.value || jsonb_build_object('createdBy',auth.uid(),'recordedAt',statement_timestamp()) end order by x.ordinality)
      from jsonb_array_elements(p_state->collection_name) with ordinality x(value,ordinality)), '[]'::jsonb));
  end loop;
  foreach collection_name in array array['items','movements','documents','reservations'] loop
    if jsonb_typeof(p_state->collection_name) is distinct from 'array' then raise exception 'Invalid warehouse collection'; end if;
    if exists(select 1 from jsonb_array_elements(p_state->collection_name) x
      where jsonb_typeof(x)<>'object' or coalesce(btrim(x->>'id'),'')='') then raise exception 'Missing warehouse row identity'; end if;
    if (select count(*) from jsonb_array_elements(p_state->collection_name)) <>
       (select count(distinct x->>'id') from jsonb_array_elements(p_state->collection_name) x) then raise exception 'Duplicate warehouse row identity'; end if;
  end loop;
  -- Audit rows and posted documents cannot be silently rewritten/deleted.
  foreach collection_name in array array['movements','documents'] loop
    for previous_entry in select value from jsonb_array_elements(current_row.state->collection_name) loop
      if collection_name='documents' and previous_entry->>'status'='draft' then continue; end if;
      if not exists(select 1 from jsonb_array_elements(p_state->collection_name) x where x=previous_entry) then
        raise exception 'Posted warehouse history is immutable';
      end if;
    end loop;
  end loop;
  for entry in select value from jsonb_array_elements(p_state->'items') loop
    item_id := entry->>'id';
    if coalesce(entry->>'currency','UAH') not in ('USD','UAH') then raise exception 'Invalid inventory currency'; end if;
    if exists(select 1 from jsonb_array_elements(current_row.state->'items') x where x->>'id'=item_id and coalesce(x->>'currency','UAH') is distinct from coalesce(entry->>'currency','UAH')) then
      raise exception 'Inventory currency is fixed; create a separate product';
    end if;
    if coalesce(btrim(entry->>'name'),'')='' or coalesce(btrim(entry->>'unit'),'')='' then raise exception 'Missing product name/unit'; end if;
    foreach field_name in array array['qty','minQty','purchasePrice','deliveryCost','extraCost','retailPrice','salePrice','installerPrice'] loop
      number_value := public.sparta_warehouse_number(entry->field_name);
      if number_value < 0 then raise exception 'Negative stock/cost is not allowed'; end if;
      if field_name in ('qty','minQty') and number_value<>round(number_value,3) then raise exception 'Quantity supports three decimals'; end if;
    end loop;
    new_qty := public.sparta_warehouse_number(entry->'qty');
    if entry->>'unit' in ('шт','компл') and new_qty<>trunc(new_qty) then raise exception 'Whole units require integer quantity'; end if;
    select coalesce(public.sparta_warehouse_number(x->'qty'),0) into old_qty
      from jsonb_array_elements(current_row.state->'items') x where x->>'id'=item_id;
    old_qty := coalesce(old_qty,0); delta_qty := 0;
    select public.sparta_warehouse_number(x->'purchasePrice')+public.sparta_warehouse_number(x->'deliveryCost')+public.sparta_warehouse_number(x->'extraCost')
      into old_unit_cost from jsonb_array_elements(current_row.state->'items') x where x->>'id'=item_id;
    old_unit_cost := coalesce(old_unit_cost,0); inventory_value := old_qty*old_unit_cost;
    for movement in select value from jsonb_array_elements(p_state->'movements') x
      where x->>'itemId'=item_id and not exists(select 1 from jsonb_array_elements(current_row.state->'movements') o where o->>'id'=x->>'id') loop
      if coalesce(movement->>'currency','UAH') is distinct from coalesce(entry->>'currency','UAH') then raise exception 'Movement currency must match product'; end if;
      number_value := public.sparta_warehouse_number(movement->'qty');
      if movement->>'type' not in ('purchase','project','return','sale','adjustment','consume') then raise exception 'Unsupported stock movement'; end if;
      if movement->>'type'<>'adjustment' and number_value<=0 then raise exception 'Movement quantity must be positive'; end if;
      movement_cost := public.sparta_warehouse_number(movement->'unitCost');
      if movement_cost<0 then raise exception 'Movement cost must be nonnegative'; end if;
      if movement->>'type' in ('project','sale') and abs(movement_cost-old_unit_cost)>0.000001 then raise exception 'Issue cost must use the inventory cost at posting'; end if;
      inventory_value := inventory_value + case movement->>'type'
        when 'purchase' then number_value*movement_cost when 'return' then number_value*movement_cost
        when 'project' then -number_value*old_unit_cost when 'sale' then -number_value*old_unit_cost
        when 'adjustment' then public.sparta_warehouse_number(movement->'delta')*old_unit_cost else 0 end;
      delta_qty := delta_qty + case movement->>'type' when 'purchase' then number_value when 'return' then number_value
        when 'project' then -number_value when 'sale' then -number_value when 'adjustment' then public.sparta_warehouse_number(movement->'delta') else 0 end;
      if not exists(select 1 from jsonb_array_elements(p_state->'documents') d where d->>'id'=movement->>'documentId' and d->>'status'='posted') then raise exception 'Movement requires a posted document'; end if;
    end loop;
    if new_qty<>old_qty+delta_qty then raise exception 'Stock changes require matching document movements'; end if;
    if abs(new_qty*(public.sparta_warehouse_number(entry->'purchasePrice')+public.sparta_warehouse_number(entry->'deliveryCost')+public.sparta_warehouse_number(entry->'extraCost'))-inventory_value)>0.01 then
      raise exception 'Inventory value changes require matching receipt/return documents';
    end if;
    select coalesce(sum(public.sparta_warehouse_number(x->'qty')),0) into reserved_qty
      from jsonb_array_elements(p_state->'reservations') x where x->>'itemId'=item_id;
    if reserved_qty>new_qty then raise exception 'Reservations exceed physical stock'; end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(current_row.state->'items') old_item
    where not exists(select 1 from jsonb_array_elements(p_state->'items') new_item where new_item->>'id'=old_item->>'id')) then
    raise exception 'Archive products instead of deleting inventory history';
  end if;
  for entry in select value from jsonb_array_elements(p_state->'reservations') loop
    if public.sparta_warehouse_number(entry->'qty')<=0 then raise exception 'Reservation must be positive'; end if;
    if exists(select 1 from jsonb_array_elements(p_state->'items') i join public.projects p on p.company_id=p_company_id and p.client_id=entry->>'projectId' where i->>'id'=entry->>'itemId' and coalesce(i->>'currency','UAH')<>p.currency) then raise exception 'Reservation currency must match project'; end if;
    if not exists(select 1 from jsonb_array_elements(p_state->'items') x where x->>'id'=entry->>'itemId')
       or not exists(select 1 from public.projects p where p.company_id=p_company_id and p.client_id=entry->>'projectId') then raise exception 'Reservation must reference company inventory/project'; end if;
  end loop;
  for entry in select value from jsonb_array_elements(p_state->'documents') x
    where not exists(select 1 from jsonb_array_elements(current_row.state->'documents') o where o->>'id'=x->>'id' and o->>'status'<>'draft') loop
    if coalesce(entry->>'currency','UAH') not in ('USD','UAH') then raise exception 'Invalid document currency'; end if;
    if entry->>'status'='posted' and exists(select 1 from jsonb_array_elements(entry->'lines') l join jsonb_array_elements(p_state->'items') i on i->>'id'=l->>'itemId' where coalesce(i->>'currency','UAH')<>coalesce(entry->>'currency','UAH') or coalesce(l->>'currency',entry->>'currency','UAH')<>coalesce(entry->>'currency','UAH')) then raise exception 'Document lines must use one currency'; end if;
  end loop;
  -- Reject references to another company's project, and require material update
  -- rows for every new issue/return/installation confirmation.
  for movement in select value from jsonb_array_elements(p_state->'movements') x
    where not exists(select 1 from jsonb_array_elements(current_row.state->'movements') o where o->>'id'=x->>'id') loop
    if not exists(select 1 from jsonb_array_elements(p_state->'items') i where i->>'id'=movement->>'itemId') then raise exception 'Unknown movement product'; end if;
    if coalesce(movement->>'projectId','')<>'' and not exists(select 1 from public.projects p where p.company_id=p_company_id and p.client_id=movement->>'projectId') then raise exception 'Unknown company project'; end if;
    if coalesce(movement->>'projectId','')<>'' and exists(select 1 from public.projects p where p.company_id=p_company_id and p.client_id=movement->>'projectId' and p.currency<>coalesce(movement->>'currency','UAH')) then raise exception 'Movement currency must match project'; end if;
    if movement->>'type' in ('project','return','consume') and not exists(select 1 from jsonb_array_elements(p_project_updates) u where u->>'id'=movement->>'projectId') then raise exception 'Project movement requires atomic material update'; end if;
  end loop;
  if (select count(*) from jsonb_array_elements(p_project_updates))<>(select count(distinct x->>'id') from jsonb_array_elements(p_project_updates) x) then raise exception 'Duplicate material update'; end if;
  for update_entry in select value from jsonb_array_elements(p_project_updates) order by value->>'id' loop
    select * into project_row from public.projects where company_id=p_company_id and client_id=update_entry->>'id' for update;
    if not found then raise exception 'Project does not belong to company'; end if;
    old_materials := public.sparta_warehouse_materials(project_row.id);
    if old_materials->>'token' is distinct from update_entry->>'token' then raise exception 'Materials changed; reload before posting' using errcode='40001'; end if;
    if jsonb_typeof(update_entry->'materials') is distinct from 'array' then raise exception 'Materials must be an array'; end if;
    fresh_materials := update_entry->'materials';
    for material in select value from jsonb_array_elements(fresh_materials) loop
      if coalesce(material->>'currency','UAH')<>project_row.currency then raise exception 'Material currency must match project'; end if;
      if coalesce(material->>'warehouseItemId','')<>'' and exists(select 1 from jsonb_array_elements(p_state->'items') i where i->>'id'=material->>'warehouseItemId' and coalesce(i->>'currency','UAH')<>project_row.currency) then raise exception 'Product currency must match material'; end if;
      if coalesce(btrim(material->>'name'),'')='' then raise exception 'Material name is required'; end if;
      foreach field_name in array array['plannedQty','issuedQty','actualQty','purchasePriceSnapshot','salePriceSnapshot'] loop
        if public.sparta_warehouse_number(material->field_name)<0 then raise exception 'Material quantities/costs must be nonnegative'; end if;
      end loop;
      if public.sparta_warehouse_number(material->'actualQty')>public.sparta_warehouse_number(material->'issuedQty') and coalesce(material->>'warehouseItemId','')<>'' then raise exception 'Installed quantity exceeds issued quantity'; end if;
    end loop;
    -- Aggregate by item because a project may have several lines for one SKU.
    for item_id in select distinct value->>'warehouseItemId' from jsonb_array_elements((old_materials->'materials')||fresh_materials) where coalesce(value->>'warehouseItemId','')<>'' loop
      if not exists(select 1 from jsonb_array_elements(p_state->'items') i where i->>'id'=item_id) then raise exception 'Unknown warehouse material'; end if;
      select coalesce(sum(public.sparta_warehouse_number(x->'issuedQty')),0),coalesce(sum(public.sparta_warehouse_number(x->'actualQty')),0)
        into issued_delta,actual_delta from jsonb_array_elements(fresh_materials) x where x->>'warehouseItemId'=item_id;
      select issued_delta-coalesce(sum(public.sparta_warehouse_number(x->'issuedQty')),0),actual_delta-coalesce(sum(public.sparta_warehouse_number(x->'actualQty')),0)
        into issued_delta,actual_delta from jsonb_array_elements(old_materials->'materials') x where x->>'warehouseItemId'=item_id;
      select coalesce(sum(case x->>'type' when 'project' then public.sparta_warehouse_number(x->'qty') when 'return' then -public.sparta_warehouse_number(x->'qty') else 0 end),0),
        coalesce(sum(case when x->>'type'='consume' then public.sparta_warehouse_number(x->'qty') else 0 end),0)
        into expected_issued,expected_actual from jsonb_array_elements(p_state->'movements') x
        where x->>'projectId'=project_row.client_id and x->>'itemId'=item_id
          and not exists(select 1 from jsonb_array_elements(current_row.state->'movements') o where o->>'id'=x->>'id');
      if issued_delta<>expected_issued or actual_delta<>expected_actual then raise exception 'Issued/installed materials require matching warehouse documents'; end if;
      select coalesce(sum(public.sparta_warehouse_number(x->'issuedQty')),0),
        coalesce(sum(public.sparta_warehouse_number(x->'issuedQty')*public.sparta_warehouse_number(x->'purchasePriceSnapshot')),0),
        coalesce(sum(public.sparta_warehouse_number(x->'issuedQty')*public.sparta_warehouse_number(x->'salePriceSnapshot')),0)
        into old_issued,old_material_cost,old_material_sale from jsonb_array_elements(old_materials->'materials') x where x->>'warehouseItemId'=item_id;
      for movement in select value from jsonb_array_elements(p_state->'movements') x
        where x->>'projectId'=project_row.client_id and x->>'itemId'=item_id
          and not exists(select 1 from jsonb_array_elements(current_row.state->'movements') o where o->>'id'=x->>'id') loop
        if movement->>'type' in ('return','consume') and (old_issued<=0
          or abs(public.sparta_warehouse_number(movement->'unitCost')-old_material_cost/old_issued)>0.000001
          or abs(public.sparta_warehouse_number(movement->'materialSalePrice')-old_material_sale/old_issued)>0.000001) then
          raise exception 'Return/consume must preserve original material cost snapshots';
        end if;
        if movement->>'type'='project' then
          select public.sparta_warehouse_number(coalesce(i->'installerPrice',i->'salePrice')) into expected_sale
            from jsonb_array_elements(current_row.state->'items') i where i->>'id'=item_id;
          if abs(public.sparta_warehouse_number(movement->'materialSalePrice')-expected_sale)>0.000001 then raise exception 'Issue sale snapshot must use the catalog price at posting'; end if;
        end if;
      end loop;
      select coalesce(sum(public.sparta_warehouse_number(x->'issuedQty')*public.sparta_warehouse_number(x->'purchasePriceSnapshot')),0),
        coalesce(sum(public.sparta_warehouse_number(x->'issuedQty')*public.sparta_warehouse_number(x->'salePriceSnapshot')),0)
        into cost_delta,sale_delta from jsonb_array_elements(fresh_materials) x where x->>'warehouseItemId'=item_id;
      select cost_delta-coalesce(sum(public.sparta_warehouse_number(x->'issuedQty')*public.sparta_warehouse_number(x->'purchasePriceSnapshot')),0),
        sale_delta-coalesce(sum(public.sparta_warehouse_number(x->'issuedQty')*public.sparta_warehouse_number(x->'salePriceSnapshot')),0)
        into cost_delta,sale_delta from jsonb_array_elements(old_materials->'materials') x where x->>'warehouseItemId'=item_id;
      select coalesce(sum((case x->>'type' when 'project' then 1 when 'return' then -1 else 0 end)*public.sparta_warehouse_number(x->'qty')*public.sparta_warehouse_number(x->'unitCost')),0),
        coalesce(sum((case x->>'type' when 'project' then 1 when 'return' then -1 else 0 end)*public.sparta_warehouse_number(x->'qty')*public.sparta_warehouse_number(x->'materialSalePrice')),0)
        into expected_cost,expected_sale from jsonb_array_elements(p_state->'movements') x
        where x->>'projectId'=project_row.client_id and x->>'itemId'=item_id
          and not exists(select 1 from jsonb_array_elements(current_row.state->'movements') o where o->>'id'=x->>'id');
      if abs(cost_delta-expected_cost)>0.01 or abs(sale_delta-expected_sale)>0.01 then
        raise exception 'Historical material cost snapshots require matching issue/return documents';
      end if;
    end loop;
    perform set_config('sparta.warehouse_rpc', 'on', true);
    delete from public.project_materials where project_id=project_row.id;
    insert into public.project_materials(project_id,category,name,quantity,unit,app_data)
      select project_row.id,coalesce(x->>'category','Інше'),x->>'name',public.sparta_warehouse_number(x->'actualQty'),coalesce(x->>'unit','шт'),x
      from jsonb_array_elements(fresh_materials) x;
  end loop;
  -- Relational catalog mirrors stay in the same database transaction as the
  -- document journal and project quantities. Full metadata remains in app_data.
  perform set_config('sparta.warehouse_rpc', 'on', true);
  insert into public.warehouse_items(company_id,client_item_id,category,name,sku,unit,quantity,purchase_price,sale_price,min_quantity,location,created_by,app_data)
    select p_company_id,x->>'id',coalesce(x->>'category','Інше'),x->>'name',coalesce(x->>'sku',''),coalesce(x->>'unit','шт'),
      public.sparta_warehouse_number(x->'qty'),public.sparta_warehouse_number(x->'purchasePrice'),
      public.sparta_warehouse_number(coalesce(x->'retailPrice',x->'salePrice')),public.sparta_warehouse_number(x->'minQty'),coalesce(x->>'location',''),auth.uid(),x
    from jsonb_array_elements(p_state->'items') x
    on conflict(company_id,client_item_id) do update set category=excluded.category,name=excluded.name,sku=excluded.sku,
      unit=excluded.unit,quantity=excluded.quantity,purchase_price=excluded.purchase_price,sale_price=excluded.sale_price,
      min_quantity=excluded.min_quantity,location=excluded.location,app_data=excluded.app_data,updated_at=now();
  update public.warehouse_workspaces set state=p_state,revision=revision+1,updated_by=auth.uid(),updated_at=now() where company_id=p_company_id;
  insert into public.warehouse_requests(company_id,request_id,revision,created_by) values(p_company_id,p_request_id,current_row.revision+1,auth.uid());
  return public.sparta_warehouse_read(p_company_id);
end $$;
revoke all on function public.sparta_warehouse_write(uuid,uuid,bigint,jsonb,jsonb) from public;
grant execute on function public.sparta_warehouse_write(uuid,uuid,bigint,jsonb,jsonb) to authenticated;

-- Older app tabs must not repopulate a cleaned company with cached stock.
-- All authenticated stock/material writes go through the atomic RPC.
create or replace function public.sparta_warehouse_guard_mirrors()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_company uuid;
begin
  if auth.uid() is null or current_setting('sparta.warehouse_rpc',true)='on' then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if tg_table_name='warehouse_items' then
    if tg_op='DELETE' then target_company:=old.company_id; else target_company:=new.company_id; end if;
  else
    if tg_op='DELETE' then
      select company_id into target_company from public.projects where id=old.project_id;
    else
      select company_id into target_company from public.projects where id=new.project_id;
    end if;
  end if;
  raise exception 'Use sparta_warehouse_write; direct stock/material sync is disabled' using errcode='40001';
end $$;
revoke all on function public.sparta_warehouse_guard_mirrors() from public;
drop trigger if exists sparta_warehouse_guard on public.warehouse_items;
create trigger sparta_warehouse_guard before insert or update or delete on public.warehouse_items
  for each row execute function public.sparta_warehouse_guard_mirrors();
drop trigger if exists sparta_material_guard on public.project_materials;
create trigger sparta_material_guard before insert or update or delete on public.project_materials
  for each row execute function public.sparta_warehouse_guard_mirrors();

notify pgrst, 'reload schema';
commit;

-- Recoverable clean start for the user's explicitly disposable test company.
-- Run ONLY in Supabase SQL Editor as postgres. No auth accounts/files are deleted.
-- archive_company is idempotent by label; the same release cannot clear new data twice.
begin;
create schema if not exists sparta_archive;
revoke all on schema sparta_archive from public, anon, authenticated;
create table if not exists sparta_archive.snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  label text not null,
  saved_at timestamptz not null default now(),
  data jsonb not null,
  restored_at timestamptz,
  unique(company_id,label)
);
alter table sparta_archive.snapshots enable row level security;
revoke all on sparta_archive.snapshots from public, anon, authenticated;

create or replace function sparta_archive.archive_company(p_company uuid,p_label text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare backup_id uuid; contents jsonb := '{}'::jsonb; rows_json jsonb; table_name text;
begin
  if current_user not in ('postgres','supabase_admin') then raise exception 'SQL Editor administrator required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company::text,34));
  lock table public.projects,public.project_technical,public.project_strings,public.project_materials,public.project_photos,public.project_files,public.project_tasks,public.warehouse_items,public.material_catalog,public.company_invitations,public.warehouse_workspaces,public.warehouse_requests,public.cash_transactions in share row exclusive mode;
  select id into backup_id from sparta_archive.snapshots where company_id=p_company and label=p_label;
  if backup_id is not null then return backup_id; end if;
  if exists(select 1 from public.cash_transactions where company_id=p_company) then
    raise exception 'Cash history exists. Archive it separately; this clean-start tool never removes posted cash.';
  end if;
  for table_name in select unnest(array['projects','warehouse_items','project_tasks','material_catalog','company_invitations','warehouse_workspaces','warehouse_requests']) loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.%I t where company_id=$1',table_name) into rows_json using p_company;
    contents:=contents||jsonb_build_object(table_name,rows_json);
  end loop;
  for table_name in select unnest(array['project_technical','project_strings','project_materials','project_photos','project_files']) loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.%I t join public.projects p on p.id=t.project_id where p.company_id=$1',table_name) into rows_json using p_company;
    contents:=contents||jsonb_build_object(table_name,rows_json);
  end loop;
  insert into sparta_archive.snapshots(company_id,label,data) values(p_company,p_label,contents) returning id into backup_id;
  delete from public.project_tasks where company_id=p_company;
  delete from public.projects where company_id=p_company;
  delete from public.warehouse_requests where company_id=p_company;
  delete from public.warehouse_workspaces where company_id=p_company;
  delete from public.warehouse_items where company_id=p_company;
  delete from public.material_catalog where company_id=p_company;
  delete from public.company_invitations where company_id=p_company;
  return backup_id;
end $$;

create or replace function sparta_archive.restore_snapshot(p_snapshot uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare snapshot_row sparta_archive.snapshots%rowtype; table_name text; has_rows boolean;
begin
  if current_user not in ('postgres','supabase_admin') then raise exception 'SQL Editor administrator required'; end if;
  select * into strict snapshot_row from sparta_archive.snapshots where id=p_snapshot for update;
  if snapshot_row.restored_at is not null then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(snapshot_row.company_id::text,34));
  lock table public.projects,public.project_technical,public.project_strings,public.project_materials,public.project_photos,public.project_files,public.project_tasks,public.warehouse_items,public.material_catalog,public.company_invitations,public.warehouse_workspaces,public.warehouse_requests,public.cash_transactions in share row exclusive mode;
  for table_name in select unnest(array['projects','warehouse_items','project_tasks','material_catalog','company_invitations','warehouse_workspaces','warehouse_requests','cash_transactions']) loop
    execute format('select exists(select 1 from public.%I where company_id=$1)',table_name) into has_rows using snapshot_row.company_id;
    if has_rows then raise exception 'Restore requires an empty company workspace; existing work is never overwritten'; end if;
  end loop;
  perform set_config('sparta.project_write_company',snapshot_row.company_id::text,true);
  for table_name in select unnest(array['projects','warehouse_items','project_tasks','material_catalog','company_invitations','project_technical','project_strings','project_materials','project_photos','project_files','warehouse_workspaces','warehouse_requests']) loop
    -- Pre-currency backups contain UAH values. Never apply the new USD default
    -- to historical amounts, including when restoring a build 34 snapshot.
    execute format('insert into public.%1$I select * from jsonb_populate_recordset(null::public.%1$I,$1)',table_name)
      using case when table_name='projects' then
        (select coalesce(jsonb_agg(jsonb_build_object('currency','UAH') || x),'[]'::jsonb) from jsonb_array_elements(coalesce(snapshot_row.data->table_name,'[]'::jsonb)) x)
      else coalesce(snapshot_row.data->table_name,'[]'::jsonb) end;
  end loop;
  update sparta_archive.snapshots set restored_at=now() where id=p_snapshot;
end $$;
revoke all on function sparta_archive.archive_company(uuid,text),sparta_archive.restore_snapshot(uuid) from public,anon,authenticated;
commit;

notify pgrst, 'reload schema';
