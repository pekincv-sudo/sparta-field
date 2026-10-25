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
