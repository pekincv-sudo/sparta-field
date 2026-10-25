-- Existing Sparta Power schema upgrade. No business records are deleted or imported.
-- Apply before warehouse-cloud.sql, cash-transactions.sql and private-storage.sql.
begin;
alter type public.project_status add value if not exists 'proposal';
alter type public.project_status add value if not exists 'contract';
alter type public.project_status add value if not exists 'service';
alter table public.projects add column if not exists app_data jsonb not null default '{}'::jsonb;
alter table public.projects add column if not exists finance jsonb not null default '{}'::jsonb;
alter table public.projects add column if not exists work_checklist jsonb not null default '{}'::jsonb;
alter table public.project_technical add column if not exists panel_serial_numbers text not null default '';
alter table public.project_technical add column if not exists equipment_details jsonb not null default '{}'::jsonb;
alter table public.project_tasks add column if not exists assigned_to uuid references public.profiles(id) on delete set null;
commit;
