-- Build52: one atomic installation confirmation with its actual date and goods.
-- This changes guards only. It does not create stock, cash or project records.
-- Apply after the existing team/buyer/cash migrations. Existing permissions,
-- buyer holds, revision locks, material tokens and audit attribution stay intact.
begin;
do $migration$
declare
  definition text;
  old_guard text := $old$        if movement->>'type' in ('return','consume') and (old_issued<=0
          or abs(public.sparta_warehouse_number(movement->'unitCost')-old_material_cost/old_issued)>0.000001
          or abs(public.sparta_warehouse_number(movement->'materialSalePrice')-old_material_sale/old_issued)>0.000001) then
          raise exception 'Return/consume must preserve original material cost snapshots';
        end if;$old$;
  new_guard text := $new$        -- Build52: only a first installation may consume an atomic first issue.
        -- Existing issued goods continue to use their original cost snapshots.
        if movement->>'type' in ('return','consume') then
          if old_issued>0 then
            if abs(public.sparta_warehouse_number(movement->'unitCost')-old_material_cost/old_issued)>0.000001
              or abs(public.sparta_warehouse_number(movement->'materialSalePrice')-old_material_sale/old_issued)>0.000001 then
              raise exception 'Return/consume must preserve original material cost snapshots';
            end if;
          elsif movement->>'type'='consume' and exists(
            select 1 from jsonb_array_elements(p_state->'documents') d
            where d->>'id'=movement->>'documentId' and d->>'kind'='installation_completion'
              and d->>'status'='posted' and d->>'projectId'=project_row.client_id
              and not exists(select 1 from jsonb_array_elements(current_row.state->'documents') o where o->>'id'=d->>'id')
          ) then
            select coalesce(sum(public.sparta_warehouse_number(x->'qty')),0),
              coalesce(sum(public.sparta_warehouse_number(x->'qty')*public.sparta_warehouse_number(x->'unitCost')),0),
              coalesce(sum(public.sparta_warehouse_number(x->'qty')*public.sparta_warehouse_number(x->'materialSalePrice')),0)
              into completion_issued,completion_cost,completion_sale
              from jsonb_array_elements(p_state->'movements') x
              where x->>'type'='project' and x->>'itemId'=item_id and x->>'projectId'=project_row.client_id
                and x->>'documentId'=movement->>'documentId'
                and not exists(select 1 from jsonb_array_elements(current_row.state->'movements') o where o->>'id'=x->>'id');
            if completion_issued<=0 then raise exception 'First installation requires matching atomic issue cost snapshots'; end if;
            if public.sparta_warehouse_number(movement->'qty')>completion_issued
              or abs(public.sparta_warehouse_number(movement->'unitCost')-completion_cost/completion_issued)>0.000001
              or abs(public.sparta_warehouse_number(movement->'materialSalePrice')-completion_sale/completion_issued)>0.000001 then
              raise exception 'First installation requires matching atomic issue cost snapshots';
            end if;
          else
            raise exception 'Return/consume must preserve original material cost snapshots';
          end if;
        end if;$new$;
  anchor text := $anchor$  for entry in select value from jsonb_array_elements(p_state->'items') loop$anchor$;
  completion_guard text := $guard$  -- Build52 installation completion metadata is part of this warehouse commit.
  for completion_entry in select value from jsonb_array_elements(p_state->'documents') d
    where d->>'kind'='installation_completion'
      and not exists(select 1 from jsonb_array_elements(current_row.state->'documents') o where o->>'id'=d->>'id' and o->>'status'<>'draft') loop
    if completion_entry->>'type' is distinct from 'consume' or completion_entry->>'status' is distinct from 'posted'
      or coalesce(completion_entry->>'projectId','')='' then
      raise exception 'Installation completion requires a posted project consumption document';
    end if;
    -- createdBy/recordedAt above are canonicalized by the existing audit loop.
    -- The nested display actor must refer to that same authenticated account.
    if completion_entry->>'createdBy' is distinct from auth.uid()::text
      or completion_entry #>> '{actor,id}' is distinct from auth.uid()::text then
      raise exception 'Installation completion actor must match the authenticated user' using errcode='42501';
    end if;
    select * into completion_project from public.projects
      where company_id=p_company_id and client_id=completion_entry->>'projectId' for update;
    if not found then raise exception 'Installation completion project does not belong to company'; end if;
    if exists(select 1 from jsonb_array_elements(p_state->'documents') d
      where d->>'kind'='installation_completion' and d->>'status'='posted'
        and d->>'projectId'=completion_project.client_id and d->>'id'<>completion_entry->>'id') then
      raise exception 'Installation has already been completed for this project';
    end if;
    if coalesce(completion_entry->>'completedOn','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'Installation completion requires an ISO date';
    end if;
    completion_date:=(completion_entry->>'completedOn')::date;
    if to_char(completion_date,'YYYY-MM-DD')<>completion_entry->>'completedOn'
      or completion_date>(statement_timestamp() at time zone 'Europe/Kyiv')::date then
      raise exception 'Installation completion date cannot be in the future';
    end if;
    if coalesce(completion_entry->>'currency','UAH')<>completion_project.currency
      or jsonb_typeof(completion_entry->'finalLines') is distinct from 'array'
      or jsonb_array_length(completion_entry->'finalLines')=0 then
      raise exception 'Installation completion requires actual equipment in project currency';
    end if;
    if (select count(*) from jsonb_array_elements(completion_entry->'finalLines'))<>
      (select count(distinct l->>'itemId') from jsonb_array_elements(completion_entry->'finalLines') l) then
      raise exception 'Duplicate installation equipment';
    end if;
    select u->'materials' into completion_materials from jsonb_array_elements(p_project_updates) u
      where u->>'id'=completion_project.client_id;
    if completion_materials is null then
      completion_materials:=public.sparta_warehouse_materials(completion_project.id)->'materials';
    end if;
    if jsonb_typeof(completion_materials) is distinct from 'array' then raise exception 'Installation materials must be an array'; end if;
    for completion_line in select value from jsonb_array_elements(completion_entry->'finalLines') loop
      select value into completion_item from jsonb_array_elements(p_state->'items') i where i->>'id'=completion_line->>'itemId';
      if completion_item is null or coalesce(completion_item->>'currency','UAH')<>completion_project.currency
        or coalesce(completion_line->>'currency',completion_project.currency)<>completion_project.currency
        or completion_line->>'unit' is distinct from completion_item->>'unit' then
        raise exception 'Installation equipment must match warehouse currency and unit';
      end if;
      if coalesce(completion_item->>'serialTracking','false')<>'false'
        or coalesce(btrim(completion_item->>'serialNumber'),'')<>''
        or (jsonb_typeof(completion_item->'serialNumbers')='array' and jsonb_array_length(completion_item->'serialNumbers')>0) then
        raise exception 'Installation confirmation requires explicit serial-number handling for this equipment';
      end if;
      if exists(select 1 from jsonb_array_elements(completion_materials) x
        where x->>'warehouseItemId'=completion_line->>'itemId'
          and (coalesce(x->>'currency','UAH')<>completion_project.currency or x->>'unit' is distinct from completion_item->>'unit')) then
        raise exception 'Installation materials must match warehouse currency and unit';
      end if;
      completion_actual:=public.sparta_warehouse_number(completion_line->'qty');
      if completion_actual<=0 or completion_actual<>round(completion_actual,3)
        or (completion_item->>'unit' in ('шт','компл') and completion_actual<>trunc(completion_actual)) then
        raise exception 'Invalid installation equipment quantity';
      end if;
      select coalesce(sum(public.sparta_warehouse_number(x->'actualQty')),0) into completion_expected
        from jsonb_array_elements(completion_materials) x where x->>'warehouseItemId'=completion_line->>'itemId';
      if completion_actual<>completion_expected then
        raise exception 'Installation completion must match actual installed quantities';
      end if;
    end loop;
    if exists(select 1 from jsonb_array_elements(completion_materials) x
      where public.sparta_warehouse_number(x->'actualQty')>0
        and not exists(select 1 from jsonb_array_elements(completion_entry->'finalLines') l
          where coalesce(x->>'warehouseItemId','')<>'' and l->>'itemId'=x->>'warehouseItemId')) then
      raise exception 'Installation completion must include all actual equipment';
    end if;
    if exists(select 1 from jsonb_array_elements(p_state->'movements') m
      where m->>'documentId'=completion_entry->>'id'
        and (m->>'projectId' is distinct from completion_project.client_id
          or m->>'type' not in ('project','consume')
          or not exists(select 1 from jsonb_array_elements(completion_entry->'finalLines') l where l->>'itemId'=m->>'itemId'))) then
      raise exception 'Installation document movements must match its project and equipment';
    end if;
  end loop;
$guard$;
begin
  select pg_get_functiondef(to_regprocedure('public.sparta_warehouse_write(uuid,uuid,bigint,jsonb,jsonb)')) into definition;
  if definition is null then raise exception 'Apply the warehouse/team migrations first'; end if;
  if position('-- Build52 installation completion metadata' in definition)>0 then
    if position('-- Build52: only a first installation' in definition)=0 then raise exception 'Incomplete installation migration'; end if;
    return;
  end if;
  if position(old_guard in definition)=0 or position(anchor in definition)=0
    or position('  field_name text; collection_name text; incoming_ids text[];' in definition)=0 then
    raise exception 'Warehouse function differs from the reviewed version; migration was not applied';
  end if;
  definition:=replace(definition,'  field_name text; collection_name text; incoming_ids text[];',
    '  field_name text; collection_name text; incoming_ids text[];'||chr(10)||
    '  completion_entry jsonb; completion_line jsonb; completion_item jsonb; completion_materials jsonb;'||chr(10)||
    '  completion_project public.projects%rowtype; completion_date date;'||chr(10)||
    '  completion_actual numeric; completion_expected numeric; completion_issued numeric; completion_cost numeric; completion_sale numeric;');
  definition:=replace(definition,old_guard,new_guard);
  definition:=replace(definition,anchor,completion_guard||anchor);
  execute definition;
end $migration$;
commit;
