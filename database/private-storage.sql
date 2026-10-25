-- SPARTA field build 34. Apply after the core schema and project-files-setup.sql.
-- Restrictive guards also neutralize older permissive policies on these buckets.
begin;

alter table public.projects add column if not exists media_revision bigint not null default 0;

alter table public.project_photos add column if not exists app_data jsonb not null default '{}'::jsonb;
alter table public.project_photos add column if not exists equipment_type text not null default '';
alter table public.project_photos add column if not exists equipment_id text not null default '';
alter table public.project_files add column if not exists app_data jsonb not null default '{}'::jsonb;

-- Do not allow direct metadata writes to manufacture a grant for a guessed
-- legacy path. The transactional RPC below may retain existing legacy refs.
drop policy if exists "private photo metadata insert guard" on public.project_photos;
drop policy if exists "private photo metadata update guard" on public.project_photos;
drop policy if exists "private photo metadata read guard" on public.project_photos;
drop policy if exists "private photo metadata delete guard" on public.project_photos;
drop policy if exists "private file metadata insert guard" on public.project_files;
drop policy if exists "private file metadata update guard" on public.project_files;
drop policy if exists "private file metadata read guard" on public.project_files;
drop policy if exists "private file metadata delete guard" on public.project_files;
create policy "private photo metadata read guard" on public.project_photos as restrictive for select to public
using (exists (select 1 from public.projects p where p.id = project_id and public.is_company_member(p.company_id)));
create policy "private photo metadata delete guard" on public.project_photos as restrictive for delete to public
using (exists (select 1 from public.projects p where p.id = project_id and public.has_company_role(p.company_id, array['owner','admin','engineer','brigadier','installer']::public.member_role[])));
create policy "private photo metadata insert guard" on public.project_photos as restrictive for insert to authenticated
with check (exists (select 1 from public.projects p where p.id = project_id and split_part(storage_path,'/',1) = p.company_id::text and public.has_company_role(p.company_id, array['owner','admin','engineer','brigadier','installer']::public.member_role[])));
create policy "private photo metadata update guard" on public.project_photos as restrictive for update to authenticated
using (exists (select 1 from public.projects p where p.id = project_id and public.has_company_role(p.company_id, array['owner','admin','engineer','brigadier','installer']::public.member_role[])))
with check (exists (select 1 from public.projects p where p.id = project_id and split_part(storage_path,'/',1) = p.company_id::text and public.has_company_role(p.company_id, array['owner','admin','engineer','brigadier','installer']::public.member_role[])));
create policy "private file metadata read guard" on public.project_files as restrictive for select to public
using (exists (select 1 from public.projects p where p.id = project_id and public.is_company_member(p.company_id)));
create policy "private file metadata delete guard" on public.project_files as restrictive for delete to public
using (exists (select 1 from public.projects p where p.id = project_id and public.has_company_role(p.company_id, array['owner','admin','engineer','brigadier','installer']::public.member_role[])));
create policy "private file metadata insert guard" on public.project_files as restrictive for insert to authenticated
with check (exists (select 1 from public.projects p where p.id = project_id and split_part(storage_path,'/',1) = p.company_id::text and public.has_company_role(p.company_id, array['owner','admin','engineer','brigadier','installer']::public.member_role[])));
create policy "private file metadata update guard" on public.project_files as restrictive for update to authenticated
using (exists (select 1 from public.projects p where p.id = project_id and public.has_company_role(p.company_id, array['owner','admin','engineer','brigadier','installer']::public.member_role[])))
with check (exists (select 1 from public.projects p where p.id = project_id and split_part(storage_path,'/',1) = p.company_id::text and public.has_company_role(p.company_id, array['owner','admin','engineer','brigadier','installer']::public.member_role[])));

insert into storage.buckets (id, name, public, file_size_limit)
values ('project-photos', 'project-photos', false, 20971520),
       ('project-files', 'project-files', false, 52428800),
       ('warehouse-files', 'warehouse-files', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

create or replace function public.private_project_media_access(p_bucket text, p_name text, p_write boolean default false)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_company uuid;
  v_roles public.member_role[];
begin
  if auth.uid() is null or p_bucket not in ('project-photos','project-files','warehouse-files')
     or p_name is null or p_name = '' or length(p_name) > 2048
     or p_name ~ '(^/|(^|/)\.\.(/|$)|[[:cntrl:]])' then return false; end if;
  v_roles := case when p_bucket = 'warehouse-files'
    then array['owner','admin','warehouse']::public.member_role[]
    else array['owner','admin','engineer','brigadier','installer']::public.member_role[] end;
  if split_part(p_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_company := split_part(p_name, '/', 1)::uuid;
    return case when p_write then public.has_company_role(v_company, v_roles)
      else public.is_company_member(v_company) end;
  end if;
  -- Older uploads without a company path remain accessible only through an
  -- existing metadata row belonging to a company the caller can access.
  if p_bucket = 'project-photos' then
    return exists (select 1 from public.project_photos f join public.projects p on p.id = f.project_id
      where f.storage_path = p_name and case when p_write then public.has_company_role(p.company_id, v_roles)
        else public.is_company_member(p.company_id) end);
  elsif p_bucket = 'project-files' then
    return exists (select 1 from public.project_files f join public.projects p on p.id = f.project_id
      where f.storage_path = p_name and case when p_write then public.has_company_role(p.company_id, v_roles)
        else public.is_company_member(p.company_id) end);
  end if;
  return false;
end $$;
revoke all on function public.private_project_media_access(text,text,boolean) from public;
grant execute on function public.private_project_media_access(text,text,boolean) to authenticated;

drop policy if exists "private media read guard" on storage.objects;
drop policy if exists "private media insert guard" on storage.objects;
drop policy if exists "private media update guard" on storage.objects;
drop policy if exists "private media delete guard" on storage.objects;
drop policy if exists "company members read private media" on storage.objects;
drop policy if exists "field roles insert private media" on storage.objects;
drop policy if exists "field roles update private media" on storage.objects;
drop policy if exists "field roles delete private media" on storage.objects;

create policy "private media read guard" on storage.objects as restrictive for select to public
using (bucket_id not in ('project-photos','project-files','warehouse-files') or public.private_project_media_access(bucket_id,name,false));
create policy "private media insert guard" on storage.objects as restrictive for insert to public
with check (bucket_id not in ('project-photos','project-files','warehouse-files') or public.private_project_media_access(bucket_id,name,true));
create policy "private media update guard" on storage.objects as restrictive for update to public
using (bucket_id not in ('project-photos','project-files','warehouse-files') or public.private_project_media_access(bucket_id,name,true))
with check (bucket_id not in ('project-photos','project-files','warehouse-files') or public.private_project_media_access(bucket_id,name,true));
create policy "private media delete guard" on storage.objects as restrictive for delete to public
using (bucket_id not in ('project-photos','project-files','warehouse-files') or public.private_project_media_access(bucket_id,name,true));

create policy "company members read private media" on storage.objects for select to authenticated
using (bucket_id in ('project-photos','project-files','warehouse-files') and public.private_project_media_access(bucket_id,name,false));
create policy "field roles insert private media" on storage.objects for insert to authenticated
with check (bucket_id in ('project-photos','project-files','warehouse-files') and public.private_project_media_access(bucket_id,name,true));
create policy "field roles update private media" on storage.objects for update to authenticated
using (bucket_id in ('project-photos','project-files','warehouse-files') and public.private_project_media_access(bucket_id,name,true))
with check (bucket_id in ('project-photos','project-files','warehouse-files') and public.private_project_media_access(bucket_id,name,true));
create policy "field roles delete private media" on storage.objects for delete to authenticated
using (bucket_id in ('project-photos','project-files','warehouse-files') and public.private_project_media_access(bucket_id,name,true));

-- Metadata replacement is a single transaction. A failed insert rolls back
-- deletion, preserving the previous photo/file references.
drop function if exists public.replace_project_media(uuid,jsonb,jsonb);
create or replace function public.replace_project_media(p_project_id uuid, p_expected_revision bigint, p_photos jsonb default null, p_files jsonb default null)
returns bigint language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_company uuid;
  v_entry jsonb;
  v_path text;
  v_revision bigint;
begin
  select company_id, media_revision into v_company, v_revision from public.projects where id = p_project_id for update;
  if v_company is null or not public.has_company_role(v_company, array['owner','admin','engineer','brigadier','installer']::public.member_role[]) then
    raise exception 'No permission to update project media' using errcode = '42501';
  end if;
  if p_expected_revision is null or p_expected_revision <> v_revision then
    raise exception 'Project media changed on another device; reload before saving' using errcode = '40001';
  end if;
  if p_photos is not null then
    if jsonb_typeof(p_photos) <> 'array' or jsonb_array_length(p_photos) > 5000 then raise exception 'Invalid photo collection'; end if;
    for v_entry in select value from jsonb_array_elements(p_photos) loop
      v_path := v_entry->>'storage_path';
      if v_path is null or v_path = '' or v_path ~ '(^/|(^|/)\.\.(/|$)|[[:cntrl:]])'
        or not (split_part(v_path,'/',1) = v_company::text or exists (
          select 1 from public.project_photos where project_id = p_project_id and storage_path = v_path)) then
        raise exception 'Photo storage path does not belong to this company';
      end if;
    end loop;
    delete from public.project_photos where project_id = p_project_id;
    insert into public.project_photos (project_id, category, caption, file_name, storage_path, created_by, created_at, equipment_type, equipment_id, app_data)
      select p_project_id, coalesce(f->>'category','Інше'), coalesce(f->>'caption',''), coalesce(f->>'file_name',''), f->>'storage_path', auth.uid(),
        coalesce(nullif(f->>'created_at','')::timestamptz,now()), coalesce(f->>'equipment_type',''), coalesce(f->>'equipment_id',''),
        jsonb_build_object('stage',coalesce(f->'app_data'->>'stage',''),'crmTaskId',coalesce(f->'app_data'->>'crmTaskId',''),'cashEntryId',coalesce(f->'app_data'->>'cashEntryId',''))
      from jsonb_array_elements(p_photos) f;
  end if;
  if p_files is not null then
    if jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) > 5000 then raise exception 'Invalid file collection'; end if;
    for v_entry in select value from jsonb_array_elements(p_files) loop
      v_path := v_entry->>'storage_path';
      if v_path is null or v_path = '' or v_path ~ '(^/|(^|/)\.\.(/|$)|[[:cntrl:]])'
        or not (split_part(v_path,'/',1) = v_company::text or exists (
          select 1 from public.project_files where project_id = p_project_id and storage_path = v_path)) then
        raise exception 'File storage path does not belong to this company';
      end if;
    end loop;
    delete from public.project_files where project_id = p_project_id;
    insert into public.project_files (project_id, category, note, file_name, mime_type, file_size, storage_path, created_by, created_at, app_data)
      select p_project_id, coalesce(f->>'category','other'), coalesce(f->>'note',''), coalesce(f->>'file_name',''), coalesce(f->>'mime_type','application/octet-stream'),
        greatest(0,coalesce((f->>'file_size')::bigint,0)), f->>'storage_path', auth.uid(), coalesce(nullif(f->>'created_at','')::timestamptz,now()),
        jsonb_build_object('stage',coalesce(f->'app_data'->>'stage',''),'crmTaskId',coalesce(f->'app_data'->>'crmTaskId',''),'cashEntryId',coalesce(f->'app_data'->>'cashEntryId',''),'documentNumber',coalesce(f->'app_data'->>'documentNumber',''))
      from jsonb_array_elements(p_files) f;
  end if;
  perform set_config('sparta.project_write_company',v_company::text,true);
  update public.projects set media_revision = media_revision + 1 where id = p_project_id returning media_revision into v_revision;
  return v_revision;
end $$;
revoke all on function public.replace_project_media(uuid,bigint,jsonb,jsonb) from public;
grant execute on function public.replace_project_media(uuid,bigint,jsonb,jsonb) to authenticated;

commit;
