-- Atomic office save of the object card, technical data and string layout.
-- Apply after release34-base.sql, before private-storage.sql / field-project-sync.sql.
-- No client, object, warehouse, cash or attachment records are imported/deleted.
begin;
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
  insert into public.projects(company_id,client_id,title,created_by)
    values(p_company_id,client_key,p->>'title',auth.uid()) on conflict(company_id,client_id) do nothing;
  select * into row from public.projects where company_id=p_company_id and client_id=client_key for update;
  if row.data_revision<>p_expected_revision then raise exception 'Project changed on another device; reload before saving' using errcode='40001'; end if;
  if not public.has_company_role(p_company_id,array['owner','admin']::public.member_role[])
     and p ? 'finance' and p->'finance' is distinct from row.finance then
    raise exception 'Only owner or admin may change project finance' using errcode='42501';
  end if;
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
