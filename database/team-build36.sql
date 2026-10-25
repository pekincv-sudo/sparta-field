-- Build 36: role boundaries, team access and immutable activity. No emails or accounts created.
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
    array['owner','admin','engineer']::public.member_role[]) then
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
    array['owner','admin','warehouse','engineer']::public.member_role[]) then
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

-- Sparta build 36: managed membership, verified invitations and attributable history.
-- Apply after existing build 35 schema / RPC upgrades. No accounts are created,
-- no invitations are sent, and no existing user's role or access is expanded.
begin;
alter table public.company_members add column if not exists access_updated_at timestamptz not null default now();
alter table public.company_invitations add column if not exists full_name text not null default '';
alter table public.company_invitations add column if not exists expires_at timestamptz;
update public.company_invitations set expires_at=created_at+interval '7 days' where expires_at is null;
alter table public.company_invitations alter column expires_at set default (now()+interval '7 days');
alter table public.company_invitations alter column expires_at set not null;
alter table public.company_invitations add column if not exists revoked_at timestamptz;
alter table public.company_invitations add column if not exists accepted_by uuid;
alter table public.company_invitations add column if not exists last_delivery_attempt_at timestamptz;
alter table public.company_invitations add column if not exists last_sent_at timestamptz;
alter table public.company_invitations add column if not exists last_sent_by uuid;
alter table public.company_invitations add column if not exists last_send_status text not null default 'unsent' check(last_send_status in ('unsent','sending','sent','failed'));

create table if not exists public.company_audit_events (
  id bigint generated always as identity primary key,
  company_id uuid not null,
  occurred_at timestamptz not null default clock_timestamp(),
  actor_id uuid,
  actor_name text not null,
  actor_email text not null default '',
  actor_role text not null default '',
  action text not null,
  entity_type text not null,
  entity_id text not null,
  entity_title text not null default '',
  before_data jsonb,
  after_data jsonb,
  transaction_id bigint not null default txid_current(),
  coalesce_key text not null default 'change',
  session_key text,
  unique(company_id,transaction_id,entity_type,entity_id,coalesce_key)
);
create index if not exists company_audit_events_company_id_idx on public.company_audit_events(company_id,id desc);
create index if not exists company_audit_events_actor_idx on public.company_audit_events(company_id,actor_id,occurred_at desc);
create unique index if not exists company_audit_events_session_idx on public.company_audit_events(company_id,actor_id,action,session_key) where session_key is not null;
alter table public.company_audit_events enable row level security;
drop policy if exists "audit administrators read" on public.company_audit_events;
create policy "audit administrators read" on public.company_audit_events for select to authenticated
using(public.has_company_role(company_id,array['owner','admin']::public.member_role[]));
drop policy if exists "audit administrator scope" on public.company_audit_events;
create policy "audit administrator scope" on public.company_audit_events as restrictive for all to authenticated
using(public.has_company_role(company_id,array['owner','admin']::public.member_role[])) with check(false);
revoke all on public.company_audit_events from public,anon,authenticated,service_role;
grant select on public.company_audit_events to authenticated;

create or replace function public.sparta_audit_immutable()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  -- Collection rewrites are coalesced only inside their uncommitted transaction.
  -- Once committed, even internal helpers cannot rewrite history.
  if tg_op in ('UPDATE','DELETE') and old.transaction_id=txid_current()
     and current_setting('sparta.audit_coalesce',true)='on' then
    if tg_op='DELETE' then return old; end if;
    if new.transaction_id=old.transaction_id and new.company_id=old.company_id and new.actor_id is not distinct from old.actor_id then return new; end if;
  end if;
  raise exception 'Audit history is immutable' using errcode='55000';
end $$;
drop trigger if exists sparta_audit_immutable on public.company_audit_events;
create trigger sparta_audit_immutable before update or delete on public.company_audit_events for each row execute function public.sparta_audit_immutable();
drop trigger if exists sparta_audit_no_truncate on public.company_audit_events;
create trigger sparta_audit_no_truncate before truncate on public.company_audit_events for each statement execute function public.sparta_audit_immutable();

create or replace function public.sparta_audit_record(p_company uuid,p_action text,p_type text,p_id text,p_title text,p_before jsonb,p_after jsonb,p_actor uuid default null,p_session text default null)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=coalesce(p_actor,auth.uid()); actor_name text; actor_email text; actor_role text;
begin
  if p_company is null or (p_action in ('create','update','delete') and p_before is not distinct from p_after) then return; end if;
  select coalesce(nullif(p.full_name,''),u.email,'Користувач'),coalesce(u.email,p.email,'') into actor_name,actor_email
    from auth.users u left join public.profiles p on p.id=u.id where u.id=actor;
  select m.role::text into actor_role from public.company_members m where m.company_id=p_company and m.user_id=actor;
  if p_action not in ('create','update','delete') then
    insert into public.company_audit_events(company_id,actor_id,actor_name,actor_email,actor_role,action,entity_type,entity_id,entity_title,before_data,after_data,coalesce_key,session_key)
      values(p_company,actor,coalesce(actor_name,'Адміністратор бази'),coalesce(actor_email,''),coalesce(actor_role,''),p_action,p_type,p_id,left(coalesce(p_title,''),300),p_before,p_after,'event:'||gen_random_uuid()::text,p_session)
      on conflict do nothing;
    return;
  end if;
  perform set_config('sparta.audit_coalesce','on',true);
  insert into public.company_audit_events(company_id,actor_id,actor_name,actor_email,actor_role,action,entity_type,entity_id,entity_title,before_data,after_data)
    values(p_company,actor,coalesce(actor_name,'Адміністратор бази'),coalesce(actor_email,''),coalesce(actor_role,''),p_action,p_type,p_id,left(coalesce(p_title,''),300),p_before,p_after)
    on conflict(company_id,transaction_id,entity_type,entity_id,coalesce_key) do update set
      after_data=excluded.after_data,occurred_at=clock_timestamp(),entity_title=excluded.entity_title,
      action=case when company_audit_events.before_data is null then 'create' when excluded.after_data is null then 'delete' else 'update' end;
  delete from public.company_audit_events where company_id=p_company and transaction_id=txid_current() and entity_type=p_type and entity_id=p_id and coalesce_key='change' and before_data is not distinct from after_data;
  perform set_config('sparta.audit_coalesce','off',true);
end $$;

create or replace function public.sparta_audit_snapshot(p_table text,p_row jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb; keys text[];
begin
  if p_row is null then return null; end if;
  keys:=case p_table
    when 'projects' then array['client_id','title','client_name','client_phone','address','object_type','status','installation_date','team_name','comment','currency']
    when 'project_technical' then array['panel_manufacturer','panel_model','panel_power_w','panel_count','panel_serial_numbers','inverter_manufacturer','inverter_model','inverter_power_kw','inverter_serial_number','mppt_count','pv_inputs_per_mppt','battery_manufacturer','battery_model','battery_capacity_kwh','battery_modules_count','battery_serial_numbers']
    when 'project_strings' then array['mppt_number','pv_input_number','string_number','string_type','panel_count','orientation','tilt_angle','note']
    when 'project_materials' then array['category','name','quantity','unit']
    when 'project_photos' then array['category','caption','file_name','storage_path','equipment_type','equipment_id']
    when 'project_files' then array['category','note','file_name','mime_type','file_size','storage_path']
    when 'project_tasks' then array['client_task_id','project_client_id','title','note','task_type','status','priority','due_at','assigned_to']
    when 'warehouse_items' then array['client_item_id','category','name','sku','unit','quantity','purchase_price','sale_price','min_quantity','location']
    when 'material_catalog' then array['category','name','default_unit','is_active']
    when 'company_members' then array['user_id','role','is_active']
    when 'company_invitations' then array['email','full_name','role','invited_by','accepted_at','accepted_by','expires_at','revoked_at','created_at']
    when 'cash_transactions' then array['project_client_id','project_title','direction','category','currency','amount_minor','counterparty','purpose','occurred_at','payment_method','reverses_id']
    when 'profiles' then array['full_name','email','phone']
    when 'companies' then array['name','phone','email','address']
    else array[]::text[] end;
  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into result from jsonb_each(p_row) where key=any(keys) and jsonb_typeof(value) not in ('object','array');
  if p_table='projects' then
    result:=result||jsonb_build_object('finance',coalesce((select jsonb_object_agg(key,value) from jsonb_each(coalesce(p_row->'finance','{}'::jsonb)) where key in ('contractPrice','installationPrice','advancePaid','crewPayroll','contractNumber','contractDate') and jsonb_typeof(value) not in ('array','object')),'{}'::jsonb),
      'financeDetailsFingerprint',md5(coalesce(p_row->'finance','{}'::jsonb)::text),
      'work_checklist',coalesce(p_row->'work_checklist','{}'::jsonb));
  elsif p_table='project_technical' then
    result:=result||jsonb_build_object('equipmentFingerprint',md5(coalesce(p_row->'equipment_details','{}'::jsonb)::text));
  elsif p_table in ('project_materials','warehouse_items') then
    result:=result||coalesce((select jsonb_object_agg(key,value) from jsonb_each(coalesce(p_row->'app_data','{}'::jsonb)) where key in ('currency','warehouseItemId','plannedQty','issuedQty','actualQty','purchasePriceSnapshot','salePriceSnapshot','brand','model','deliveryCost','extraCost','installerPrice','retailPrice','supplier') and jsonb_typeof(value) not in ('array','object')),'{}'::jsonb);
  elsif p_table in ('project_files','project_photos') then
    result:=result||coalesce((select jsonb_object_agg(key,value) from jsonb_each(coalesce(p_row->'app_data','{}'::jsonb)) where key in ('stage','crmTaskId','cashEntryId') and jsonb_typeof(value) not in ('array','object')),'{}'::jsonb);
  elsif p_table='warehouse_workspaces' then
    result:=jsonb_build_object('items',jsonb_array_length(coalesce(p_row->'state'->'items','[]'::jsonb)),
      'documents',jsonb_array_length(coalesce(p_row->'state'->'documents','[]'::jsonb)),
      'movements',jsonb_array_length(coalesce(p_row->'state'->'movements','[]'::jsonb)),
      'reservations',jsonb_array_length(coalesce(p_row->'state'->'reservations','[]'::jsonb)),
      'stateFingerprint',md5(coalesce(p_row->'state','{}'::jsonb)::text));
  end if;
  return result;
end $$;

create or replace function public.sparta_audit_collection(p_table text,p_project uuid,p_remove uuid default null,p_add jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if p_table not in ('project_strings','project_materials','project_photos','project_files') then raise exception 'Unsupported audit collection'; end if;
  execute format('select jsonb_agg(value order by value::text) from (select public.sparta_audit_snapshot($1,to_jsonb(t)) as value from public.%I t where project_id=$2 and ($3 is null or id<>$3) union all select public.sparta_audit_snapshot($1,$4) where $4 is not null) rows',p_table)
    into result using p_table,p_project,p_remove,p_add;
  if result is null then return null; end if;
  return jsonb_build_object('rows',result);
end $$;

create or replace function public.sparta_audit_business_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare prior jsonb; fresh jsonb; data jsonb; company uuid; project uuid; title text; identity text; op text; target_company uuid;
begin
  if tg_op<>'INSERT' then prior:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then fresh:=to_jsonb(new); end if;
  data:=coalesce(fresh,prior);op:=case tg_op when 'INSERT' then 'create' when 'UPDATE' then 'update' else 'delete' end;
  -- BEFORE INSERT also runs for an upsert that will update or do nothing.
  -- Let the actual UPDATE trigger record the change, without a phantom create.
  if tg_op='INSERT' then
    if tg_table_name='projects' and exists(select 1 from public.projects p where p.company_id=(data->>'company_id')::uuid and p.client_id=data->>'client_id') then return new; end if;
    if tg_table_name='project_technical' and exists(select 1 from public.project_technical t where t.project_id=(data->>'project_id')::uuid) then return new; end if;
    if tg_table_name='warehouse_items' and exists(select 1 from public.warehouse_items w where w.company_id=(data->>'company_id')::uuid and w.client_item_id=data->>'client_item_id') then return new; end if;
    if tg_table_name='profiles' and exists(select 1 from public.profiles p where p.id=(data->>'id')::uuid) then return new; end if;
  end if;
  if tg_table_name='profiles' then
    for target_company in select company_id from public.company_members where user_id=(data->>'id')::uuid loop
      perform public.sparta_audit_record(target_company,op,tg_table_name,data->>'id',coalesce(data->>'full_name',data->>'email'),public.sparta_audit_snapshot(tg_table_name,prior),public.sparta_audit_snapshot(tg_table_name,fresh));
    end loop;
  else
    company:=nullif(data->>'company_id','')::uuid;
    if tg_table_name='companies' then company:=(data->>'id')::uuid; end if;
    project:=nullif(data->>'project_id','')::uuid;
    if project is not null then
      select company_id,p.title into company,title from public.projects p where id=project;
      if company is null then select e.company_id,e.entity_title into company,title from public.company_audit_events e where e.entity_type='projects' and e.entity_id=project::text and e.action='delete' and e.transaction_id=txid_current() order by e.id desc limit 1; end if;
    end if;
    identity:=coalesce(data->>'id',data->>'project_id',data->>'company_id');title:=coalesce(title,data->>'title',data->>'name',data->>'project_title',data->>'full_name',data->>'email',data->>'client_item_id',identity);
    if tg_table_name in ('project_strings','project_materials','project_photos','project_files') then
      identity:=project::text;
      prior:=public.sparta_audit_collection(tg_table_name,project);
      fresh:=public.sparta_audit_collection(tg_table_name,project,case when tg_op<>'INSERT' then old.id else null end,case when tg_op<>'DELETE' then to_jsonb(new) else null end);
    else
      prior:=public.sparta_audit_snapshot(tg_table_name,prior);fresh:=public.sparta_audit_snapshot(tg_table_name,fresh);
    end if;
    perform public.sparta_audit_record(company,op,tg_table_name,identity,title,prior,fresh);
  end if;
  if tg_op='DELETE' then return old; end if;return new;
end $$;

create or replace function public.sparta_team_write_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare company uuid; can_write boolean;
begin
  if tg_op='DELETE' then company:=old.company_id; else company:=new.company_id; end if;
  if tg_op='UPDATE' and new.company_id is distinct from old.company_id then raise exception 'Company identity cannot change'; end if;
  perform 1 from public.companies where id=company for update;
  can_write:=auth.uid() is null or current_setting('sparta.team_write_company',true)=company::text;
  if not coalesce(can_write,false) then raise exception 'Use the authorized team management RPC' using errcode='42501'; end if;
  if tg_table_name='company_members' then
    if tg_op<>'INSERT' then
      if old.role='owner' and old.is_active then
        if tg_op='DELETE' or new.role<>'owner' or not new.is_active then
          if not exists(select 1 from public.company_members m where m.company_id=company and m.user_id<>old.user_id and m.role='owner' and m.is_active) then raise exception 'The last active owner cannot be removed'; end if;
        end if;
      end if;
    end if;
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end $$;
drop trigger if exists sparta_team_member_write_guard on public.company_members;
create trigger sparta_team_member_write_guard before insert or update or delete on public.company_members for each row execute function public.sparta_team_write_guard();
drop trigger if exists sparta_team_invitation_write_guard on public.company_invitations;
create trigger sparta_team_invitation_write_guard before insert or update or delete on public.company_invitations for each row execute function public.sparta_team_write_guard();

create or replace function public.sparta_team_invitation_json(p public.company_invitations)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',p.id,'fullName',p.full_name,'email',p.email,'role',p.role,
  'status',case when p.accepted_at is not null then 'accepted' when p.revoked_at is not null then 'revoked' when p.expires_at<=now() then 'expired' else 'pending' end,
  'createdAt',p.created_at,'expiresAt',p.expires_at,'invitedBy',p.invited_by,'lastSentAt',p.last_sent_at,'lastSendStatus',p.last_send_status)
$$;

create or replace function public.sparta_team_invite(p_company_id uuid,p_email text,p_full_name text,p_role public.member_role)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_email text:=lower(btrim(p_email)); invitation public.company_invitations%rowtype; actor_role public.member_role;
begin
  perform 1 from public.companies where id=p_company_id for update;
  select role into actor_role from public.company_members where company_id=p_company_id and user_id=auth.uid() and is_active;
  if actor_role is null or actor_role not in ('owner','admin') then raise exception 'Only active owner or admin can invite users' using errcode='42501'; end if;
  if p_role is null or p_role='owner' or (actor_role<>'owner' and p_role='admin') then raise exception 'This role cannot be assigned by this user' using errcode='42501'; end if;
  if coalesce(v_email,'') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(v_email)>254 or coalesce(btrim(p_full_name),'')='' or length(p_full_name)>200 then raise exception 'Valid email and full name are required'; end if;
  if exists(select 1 from public.company_members m join auth.users u on u.id=m.user_id where m.company_id=p_company_id and m.is_active and lower(u.email)=v_email) then raise exception 'This user is already an active company member'; end if;
  perform set_config('sparta.team_write_company',p_company_id::text,true);
  select * into invitation from public.company_invitations i where i.company_id=p_company_id and lower(i.email)=v_email order by i.created_at desc limit 1 for update;
  if invitation.id is null then
    insert into public.company_invitations(company_id,email,full_name,role,invited_by,expires_at) values(p_company_id,v_email,btrim(p_full_name),p_role,auth.uid(),clock_timestamp()+interval '7 days') returning * into invitation;
  else
    update public.company_invitations i set email=v_email,full_name=btrim(p_full_name),role=p_role,invited_by=auth.uid(),accepted_at=null,accepted_by=null,revoked_at=null,created_at=clock_timestamp(),expires_at=clock_timestamp()+interval '7 days',last_send_status='unsent' where i.id=invitation.id returning * into invitation;
    update public.company_invitations i set revoked_at=clock_timestamp() where i.company_id=p_company_id and lower(i.email)=v_email and i.id<>invitation.id and i.accepted_at is null and i.revoked_at is null;
  end if;
  return public.sparta_team_invitation_json(invitation);
end $$;

create or replace function public.sparta_team_update_member(p_company_id uuid,p_user_id uuid,p_role public.member_role,p_is_active boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor_role public.member_role; member public.company_members%rowtype;
begin
  perform 1 from public.companies where id=p_company_id for update;
  select role into actor_role from public.company_members where company_id=p_company_id and user_id=auth.uid() and is_active;
  if actor_role is null or actor_role not in ('owner','admin') then raise exception 'Only active owner or admin can manage access' using errcode='42501'; end if;
  if p_user_id=auth.uid() then raise exception 'You cannot change your own access'; end if;
  select * into member from public.company_members where company_id=p_company_id and user_id=p_user_id for update;
  if member.id is null or p_role is null or p_is_active is null then raise exception 'Company member and valid access settings are required'; end if;
  if actor_role<>'owner' and (member.role in ('owner','admin') or p_role in ('owner','admin')) then raise exception 'Only owner may manage owner or admin access' using errcode='42501'; end if;
  perform set_config('sparta.team_write_company',p_company_id::text,true);
  update public.company_members set role=p_role,is_active=p_is_active,access_updated_at=clock_timestamp() where id=member.id returning * into member;
  -- Existing outstanding invitations must not undo an explicit revocation.
  if not p_is_active then
    update public.company_invitations i set revoked_at=clock_timestamp() where i.company_id=p_company_id and i.accepted_at is null and i.revoked_at is null and lower(i.email)=(select lower(email) from auth.users where id=p_user_id);
  end if;
  return jsonb_build_object('userId',member.user_id,'role',member.role,'isActive',member.is_active);
end $$;

create or replace function public.sparta_team_revoke_invitation(p_company_id uuid,p_invitation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor_role public.member_role; invitation public.company_invitations%rowtype;
begin
  perform 1 from public.companies where id=p_company_id for update;
  select role into actor_role from public.company_members where company_id=p_company_id and user_id=auth.uid() and is_active;
  select * into invitation from public.company_invitations where id=p_invitation_id and company_id=p_company_id for update;
  if actor_role is null or actor_role not in ('owner','admin') or (actor_role<>'owner' and invitation.role in ('owner','admin')) then raise exception 'Invitation management is not permitted' using errcode='42501'; end if;
  if invitation.id is null or invitation.accepted_at is not null then raise exception 'A pending invitation is required; manage the member for accepted invitations'; end if;
  perform set_config('sparta.team_write_company',p_company_id::text,true);
  update public.company_invitations set revoked_at=clock_timestamp() where id=invitation.id returning * into invitation;
  return public.sparta_team_invitation_json(invitation);
end $$;

create or replace function public.accept_company_invitation()
returns table(company_id uuid,role public.member_role) language plpgsql security definer set search_path='' as $$
declare invitation public.company_invitations%rowtype; member public.company_members%rowtype; verified_email text; target uuid;
begin
  select lower(u.email) into verified_email from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null;
  if auth.uid() is null or coalesce(verified_email,'')='' then raise exception 'A confirmed email account is required' using errcode='42501'; end if;
  select i.company_id into target from public.company_invitations i where lower(i.email)=verified_email and i.accepted_at is null and i.revoked_at is null and i.expires_at>now() and i.role<>'owner' order by i.created_at desc limit 1;
  if target is null then return; end if;
  perform 1 from public.companies where id=target for update;
  select * into invitation from public.company_invitations i where i.company_id=target and lower(i.email)=verified_email and i.accepted_at is null and i.revoked_at is null and i.expires_at>now() and i.role<>'owner' order by i.created_at desc limit 1 for update;
  if invitation.id is null then return; end if;
  select * into member from public.company_members m where m.company_id=target and m.user_id=auth.uid() for update;
  if member.id is not null and not member.is_active and invitation.created_at<=member.access_updated_at then raise exception 'Access was revoked; request a new invitation' using errcode='42501'; end if;
  perform set_config('sparta.team_write_company',target::text,true);
  insert into public.profiles(id,email,full_name) values(auth.uid(),verified_email,coalesce(nullif(invitation.full_name,''),verified_email))
    on conflict(id) do update set email=excluded.email,full_name=coalesce(nullif(public.profiles.full_name,''),excluded.full_name);
  if member.id is null then
    insert into public.company_members(company_id,user_id,role,is_active) values(target,auth.uid(),invitation.role,true) returning * into member;
  elsif not member.is_active then
    update public.company_members m set role=invitation.role,is_active=true,access_updated_at=clock_timestamp() where m.id=member.id returning * into member;
  end if;
  -- Accepting an invitation never changes an existing active member's role.
  update public.company_invitations set accepted_at=clock_timestamp(),accepted_by=auth.uid() where id=invitation.id;
  perform public.sparta_audit_record(target,'invite_accept','company_invitations',invitation.id::text,invitation.full_name,null,jsonb_build_object('role',member.role));
  return query select target,member.role;
end $$;

create or replace function public.sparta_team_list(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not public.has_company_role(p_company_id,array['owner','admin']::public.member_role[]) then raise exception 'Team access requires owner or admin' using errcode='42501'; end if;
  return jsonb_build_object('currentUserId',auth.uid(),'members',coalesce((select jsonb_agg(jsonb_build_object('userId',m.user_id,'fullName',p.full_name,'email',coalesce(u.email,p.email,''),'phone',p.phone,'role',m.role,'isActive',m.is_active,
    'lastLoginAt',(select max(e.occurred_at) from public.company_audit_events e where e.company_id=p_company_id and e.actor_id=m.user_id and e.action='login')) order by m.created_at) from public.company_members m join public.profiles p on p.id=m.user_id left join auth.users u on u.id=m.user_id where m.company_id=p_company_id),'[]'::jsonb),
    'invitations',coalesce((select jsonb_agg(public.sparta_team_invitation_json(i) order by i.created_at desc) from public.company_invitations i where i.company_id=p_company_id),'[]'::jsonb));
end $$;

create or replace function public.sparta_record_session_event(p_company_id uuid,p_event text)
returns void language plpgsql security definer set search_path='' as $$
declare claims jsonb; session_id text;
begin
  if auth.uid() is null or p_event not in ('login','logout') or p_event is null then raise exception 'Authenticated login or logout event required' using errcode='42501'; end if;
  if not public.is_company_member(p_company_id) then raise exception 'Active company membership is required' using errcode='42501'; end if;
  claims:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
  session_id:=claims->>'session_id';
  if coalesce(session_id,'') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'A verified authentication session is required'; end if;
  perform public.sparta_audit_record(p_company_id,p_event,'session',auth.uid()::text,'Сеанс користувача',null,'{}'::jsonb,null,md5(session_id||':'||auth.uid()::text));
end $$;

create or replace function public.sparta_audit_list(p_company_id uuid,p_limit integer default 50,p_before_id bigint default null,p_entity text default null,p_actor uuid default null,p_action text default null,p_from timestamptz default null,p_to timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare rows jsonb; count_rows bigint; page_size integer:=least(greatest(coalesce(p_limit,50),1),100); minimum_id bigint;
begin
  if not public.has_company_role(p_company_id,array['owner','admin']::public.member_role[]) then raise exception 'History requires owner or admin' using errcode='42501'; end if;
  if p_from is not null and p_to is not null and p_from>=p_to then raise exception 'Invalid history date range'; end if;
  select count(*) into count_rows from public.company_audit_events e where company_id=p_company_id and (p_entity is null or e.entity_type=p_entity) and (p_actor is null or e.actor_id=p_actor) and (p_action is null or e.action=p_action) and (p_from is null or e.occurred_at>=p_from) and (p_to is null or e.occurred_at<p_to);
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id::text,'occurredAt',e.occurred_at,'actorId',e.actor_id,'actorName',e.actor_name,'actorEmail',e.actor_email,'actorRole',e.actor_role,'action',e.action,'entityType',e.entity_type,'entityId',e.entity_id,'entityTitle',e.entity_title,'summary',e.entity_title,
    'changes',coalesce((select jsonb_object_agg(k,jsonb_build_object('before',e.before_data->k,'after',e.after_data->k)) from (select jsonb_object_keys(coalesce(e.before_data,'{}'::jsonb)) k union select jsonb_object_keys(coalesce(e.after_data,'{}'::jsonb)) k) fields where e.before_data->k is distinct from e.after_data->k),'{}'::jsonb)) order by e.id desc),'[]'::jsonb),min(e.id)
    into rows,minimum_id from (select * from public.company_audit_events e where company_id=p_company_id and (p_before_id is null or e.id<p_before_id) and (p_entity is null or e.entity_type=p_entity) and (p_actor is null or e.actor_id=p_actor) and (p_action is null or e.action=p_action) and (p_from is null or e.occurred_at>=p_from) and (p_to is null or e.occurred_at<p_to) order by id desc limit page_size) e;
  return jsonb_build_object('entries',rows,'total',count_rows,'nextCursor',minimum_id::text,'hasMore',minimum_id is not null and exists(select 1 from public.company_audit_events e where company_id=p_company_id and e.id<minimum_id and (p_entity is null or e.entity_type=p_entity) and (p_actor is null or e.actor_id=p_actor) and (p_action is null or e.action=p_action) and (p_from is null or e.occurred_at>=p_from) and (p_to is null or e.occurred_at<p_to)));
end $$;

create or replace function public.sparta_project_list(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare financial boolean;
begin
  if auth.uid() is null or not public.is_company_member(p_company_id) then raise exception 'Active company membership is required' using errcode='42501'; end if;
  financial:=public.has_company_role(p_company_id,array['owner','admin']::public.member_role[]);
  return coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('finance',case when financial then p.finance else '{}'::jsonb end,
    'project_technical',(select to_jsonb(t) from public.project_technical t where t.project_id=p.id limit 1),
    'project_strings',coalesce((select jsonb_agg(to_jsonb(t) order by t.mppt_number,t.pv_input_number,t.string_number) from public.project_strings t where t.project_id=p.id),'[]'::jsonb),
    'project_materials',coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.project_materials t where t.project_id=p.id),'[]'::jsonb),
    'project_photos',coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at,t.id) from public.project_photos t where t.project_id=p.id),'[]'::jsonb)) order by p.created_at desc) from public.projects p where p.company_id=p_company_id),'[]'::jsonb);
end $$;
-- A hidden form is not financial authorization. Raw SELECT * can no longer
-- bypass the finance mask, even for an outdated browser tab.
revoke select on public.projects from public,anon,authenticated;
revoke select(finance) on public.projects from public,anon,authenticated;
grant select(id,client_id,company_id,title,client_name,client_phone,address,object_type,status,installation_date,team_name,comment,work_checklist,created_by,created_at,updated_at,app_data,currency,data_revision,media_revision) on public.projects to authenticated;

create or replace function public.sparta_team_prepare_invitation_email(p_invitation_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare invitation public.company_invitations%rowtype; actor_role public.member_role;
begin
  select * into invitation from public.company_invitations where id=p_invitation_id for update;
  select m.role into actor_role from public.company_members m join auth.users u on u.id=m.user_id where m.company_id=invitation.company_id and m.user_id=p_actor_id and m.is_active and u.email_confirmed_at is not null;
  if invitation.id is null or invitation.accepted_at is not null or invitation.revoked_at is not null or invitation.expires_at<=now() or actor_role is null or actor_role not in ('owner','admin') or invitation.role='owner' or (actor_role='admin' and invitation.role='admin') then raise exception 'A pending invitation and authorized sender are required' using errcode='42501'; end if;
  if invitation.last_delivery_attempt_at>clock_timestamp()-interval '60 seconds' then raise exception 'Invitation email cooldown: wait 60 seconds' using errcode='P0001'; end if;
  perform set_config('sparta.team_write_company',invitation.company_id::text,true);
  update public.company_invitations set last_delivery_attempt_at=clock_timestamp(),last_send_status='sending' where id=invitation.id returning * into invitation;
  return to_jsonb(invitation);
end $$;

create or replace function public.sparta_team_record_invitation_delivery(p_invitation_id uuid,p_actor_id uuid,p_succeeded boolean,p_mode text)
returns void language plpgsql security definer set search_path='' as $$
declare invitation public.company_invitations%rowtype;
begin
  select * into invitation from public.company_invitations where id=p_invitation_id for update;
  if invitation.id is null or p_succeeded is null or p_mode not in ('invite','recovery') or p_mode is null or not exists(select 1 from public.company_members m join auth.users u on u.id=m.user_id where m.company_id=invitation.company_id and m.user_id=p_actor_id and m.is_active and m.role in ('owner','admin') and u.email_confirmed_at is not null and (m.role='owner' or invitation.role not in ('owner','admin'))) then raise exception 'Authorized delivery report required' using errcode='42501'; end if;
  perform set_config('sparta.team_write_company',invitation.company_id::text,true);
  update public.company_invitations set last_send_status=case when p_succeeded then 'sent' else 'failed' end,last_sent_at=case when p_succeeded then clock_timestamp() else last_sent_at end,last_sent_by=p_actor_id where id=invitation.id;
  perform public.sparta_audit_record(invitation.company_id,case when p_succeeded then 'invitation_sent' else 'invitation_delivery_failed' end,'company_invitations',invitation.id::text,invitation.full_name,null,jsonb_build_object('email',invitation.email,'mode',p_mode),p_actor_id);
end $$;

do $$ declare name text; begin
  foreach name in array array['projects','project_technical','project_strings','project_materials','project_photos','project_files','project_tasks','warehouse_items','warehouse_workspaces','material_catalog','cash_transactions','company_members','company_invitations','profiles','companies'] loop
    execute format('drop trigger if exists zz_sparta_audit_change on public.%I',name);
    execute format('create trigger zz_sparta_audit_change before insert or update or delete on public.%I for each row execute function public.sparta_audit_business_change()',name);
  end loop;
end $$;

revoke all on function public.sparta_audit_immutable(),public.sparta_audit_record(uuid,text,text,text,text,jsonb,jsonb,uuid,text),public.sparta_audit_snapshot(text,jsonb),public.sparta_audit_collection(text,uuid,uuid,jsonb),public.sparta_audit_business_change(),public.sparta_team_write_guard(),public.sparta_team_invitation_json(public.company_invitations) from public,anon,authenticated,service_role;
revoke all on function public.sparta_team_invite(uuid,text,text,public.member_role),public.sparta_team_update_member(uuid,uuid,public.member_role,boolean),public.sparta_team_revoke_invitation(uuid,uuid),public.accept_company_invitation(),public.sparta_team_list(uuid),public.sparta_record_session_event(uuid,text),public.sparta_audit_list(uuid,integer,bigint,text,uuid,text,timestamptz,timestamptz),public.sparta_project_list(uuid) from public,anon,authenticated,service_role;
grant execute on function public.sparta_team_invite(uuid,text,text,public.member_role),public.sparta_team_update_member(uuid,uuid,public.member_role,boolean),public.sparta_team_revoke_invitation(uuid,uuid),public.accept_company_invitation(),public.sparta_team_list(uuid),public.sparta_record_session_event(uuid,text),public.sparta_audit_list(uuid,integer,bigint,text,uuid,text,timestamptz,timestamptz),public.sparta_project_list(uuid) to authenticated;
revoke all on function public.sparta_team_prepare_invitation_email(uuid,uuid),public.sparta_team_record_invitation_delivery(uuid,uuid,boolean,text) from public,anon,authenticated,service_role;
grant execute on function public.sparta_team_prepare_invitation_email(uuid,uuid),public.sparta_team_record_invitation_delivery(uuid,uuid,boolean,text) to service_role;
drop policy if exists "sparta manager task read" on public.project_tasks;
drop policy if exists "sparta manager task update" on public.project_tasks;
drop policy if exists "sparta manager task delete" on public.project_tasks;
drop policy if exists "sparta office task creation" on public.project_tasks;
drop policy if exists "sparta office task deletion" on public.project_tasks;

-- Managers coordinate CRM; field staff report only against their assigned tasks.
create policy "sparta manager task read" on public.project_tasks for select to authenticated using(public.has_company_role(company_id,array['engineer']::public.member_role[]));
create policy "sparta manager task update" on public.project_tasks for update to authenticated using(public.has_company_role(company_id,array['engineer']::public.member_role[])) with check(public.has_company_role(company_id,array['engineer']::public.member_role[]));
create policy "sparta manager task delete" on public.project_tasks for delete to authenticated using(public.has_company_role(company_id,array['engineer']::public.member_role[]));
create policy "sparta office task creation" on public.project_tasks as restrictive for insert to authenticated with check(created_by=auth.uid() and public.has_company_role(company_id,array['owner','admin','engineer']::public.member_role[]));
create policy "sparta office task deletion" on public.project_tasks as restrictive for delete to authenticated using(public.has_company_role(company_id,array['owner','admin','engineer']::public.member_role[]));
create or replace function public.sparta_task_field_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then return new; end if;
  if new.company_id is distinct from old.company_id or new.created_by is distinct from old.created_by then raise exception 'Task identity and original author cannot change'; end if;
  if public.has_company_role(new.company_id,array['owner','admin','engineer']::public.member_role[]) then return new; end if;
  if old.assigned_to is distinct from auth.uid() or not public.has_company_role(new.company_id,array['brigadier','installer']::public.member_role[]) or
    (to_jsonb(new)-array['status','note','updated_at']) is distinct from (to_jsonb(old)-array['status','note','updated_at']) then
    raise exception 'Field staff may update status and notes of assigned tasks only' using errcode='42501';
  end if;
  return new;
end $$;
drop trigger if exists sparta_task_field_guard on public.project_tasks;
create trigger sparta_task_field_guard before update on public.project_tasks for each row execute function public.sparta_task_field_guard();
revoke all on function public.sparta_task_field_guard() from public,anon,authenticated;

commit;
notify pgrst,'reload schema';
