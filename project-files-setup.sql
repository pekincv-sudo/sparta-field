-- SPARTA field: project files setup.
-- Run this in Supabase SQL Editor once after the main schema is already installed.

create table if not exists public.project_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  category text not null default 'other',
  note text,
  file_name text not null,
  mime_type text not null default 'application/octet-stream',
  file_size bigint not null default 0,
  storage_path text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists project_files_project_id_idx on public.project_files(project_id);

alter table public.project_files enable row level security;

drop policy if exists "members can read files" on public.project_files;
drop policy if exists "field roles can manage files" on public.project_files;

create policy "members can read files"
on public.project_files for select
using (exists (
  select 1 from public.projects p
  where p.id = project_id and public.is_company_member(p.company_id)
));

create policy "field roles can manage files"
on public.project_files for all
using (exists (
  select 1 from public.projects p
  where p.id = project_id
    and public.has_company_role(p.company_id, array['owner', 'admin', 'engineer', 'brigadier', 'installer']::public.member_role[])
))
with check (exists (
  select 1 from public.projects p
  where p.id = project_id
    and public.has_company_role(p.company_id, array['owner', 'admin', 'engineer', 'brigadier', 'installer']::public.member_role[])
));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-files',
  'project-files',
  true,
  52428800,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip',
    'application/x-zip-compressed',
    'application/octet-stream',
    'text/plain',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "authenticated users can read project files" on storage.objects;
drop policy if exists "authenticated users can upload project files" on storage.objects;
drop policy if exists "authenticated users can update project files" on storage.objects;
drop policy if exists "authenticated users can delete project files" on storage.objects;

create policy "authenticated users can read project files"
on storage.objects for select
using (bucket_id = 'project-files' and auth.role() = 'authenticated');

create policy "authenticated users can upload project files"
on storage.objects for insert
with check (bucket_id = 'project-files' and auth.role() = 'authenticated');

create policy "authenticated users can update project files"
on storage.objects for update
using (bucket_id = 'project-files' and auth.role() = 'authenticated')
with check (bucket_id = 'project-files' and auth.role() = 'authenticated');

create policy "authenticated users can delete project files"
on storage.objects for delete
using (bucket_id = 'project-files' and auth.role() = 'authenticated');
