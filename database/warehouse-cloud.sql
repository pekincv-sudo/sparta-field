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
