-- Installer progress updates without granting general project/finance edits.
-- Apply after release34-base.sql, project-cloud.sql and private-storage.sql.
begin;
create or replace function public.update_project_field_checklist(p_project_id uuid, p_changes jsonb, p_expected jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_company uuid;
  v_checklist jsonb;
  v_key text;
  v_current jsonb;
  v_revision bigint;
  v_keys text[] := array['marking','mounting_system','plane_check','panels_install','torque_check','string_labels','cable_routing','dc_connection','ac_connection','grounding','inverter_setup','parameter_check','client_briefing'];
begin
  select company_id, coalesce(work_checklist,'{}'::jsonb), data_revision into v_company, v_checklist, v_revision
    from public.projects where id = p_project_id for update;
  if v_company is null or not public.has_company_role(v_company, array['owner','admin','engineer','brigadier','installer']::public.member_role[]) then
    raise exception 'No permission to update installer checklist' using errcode = '42501';
  end if;
  if p_changes is null or p_expected is null or jsonb_typeof(p_changes) <> 'object' or jsonb_typeof(p_expected) <> 'object' then
    raise exception 'Checklist changes and expected values must be JSON objects';
  end if;
  if (select count(*) from jsonb_object_keys(p_changes)) > cardinality(v_keys)
     or (select count(*) from jsonb_object_keys(p_changes)) <> (select count(*) from jsonb_object_keys(p_expected)) then
    raise exception 'Invalid checklist keys';
  end if;
  for v_key in select jsonb_object_keys(p_changes) loop
    if not (v_key = any(v_keys)) or jsonb_typeof(p_changes->v_key) <> 'boolean' or jsonb_typeof(p_expected->v_key) is distinct from 'boolean' then
      raise exception 'Only known boolean installer checklist values can be changed';
    end if;
    v_current := case when v_checklist->v_key = 'true'::jsonb then 'true'::jsonb else 'false'::jsonb end;
    if v_current is distinct from p_expected->v_key then
      raise exception 'Checklist item changed on another device; reload before changing it' using errcode = '40001';
    end if;
  end loop;
  if p_changes <> '{}'::jsonb then
    perform set_config('sparta.project_write_company',v_company::text,true);
    update public.projects set work_checklist = v_checklist || p_changes, data_revision = data_revision + 1 where id = p_project_id
      returning work_checklist, data_revision into v_checklist, v_revision;
  end if;
  return jsonb_build_object('checklist',v_checklist,'dataRevision',v_revision);
end $$;
revoke all on function public.update_project_field_checklist(uuid,jsonb,jsonb) from public;
grant execute on function public.update_project_field_checklist(uuid,jsonb,jsonb) to authenticated;
commit;
