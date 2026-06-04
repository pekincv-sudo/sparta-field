-- SPARTA field: shared CRM tasks setup.
-- Run this in Supabase SQL Editor once after the main schema is already installed.

create table if not exists public.project_tasks (
  id uuid primary key default gen_random_uuid(),
  client_task_id text not null,
  company_id uuid not null references public.companies(id) on delete cascade,
  project_client_id text,
  title text not null,
  note text,
  task_type text not null default 'task',
  status text not null default 'planned',
  priority text not null default 'normal',
  due_at timestamptz,
  assigned_to uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, client_task_id)
);

alter table public.project_tasks
add column if not exists assigned_to uuid references public.profiles(id) on delete set null;

create index if not exists project_tasks_company_id_idx on public.project_tasks(company_id);
create index if not exists project_tasks_project_client_id_idx on public.project_tasks(project_client_id);
create index if not exists project_tasks_due_at_idx on public.project_tasks(due_at);
create index if not exists project_tasks_assigned_to_idx on public.project_tasks(assigned_to);

drop trigger if exists project_tasks_touch_updated_at on public.project_tasks;
create trigger project_tasks_touch_updated_at
before update on public.project_tasks
for each row execute function public.touch_updated_at();

alter table public.project_tasks enable row level security;

drop policy if exists "members can view coworker profiles" on public.profiles;
drop policy if exists "members can read tasks" on public.project_tasks;
drop policy if exists "field roles can manage tasks" on public.project_tasks;
drop policy if exists "visible task users can read tasks" on public.project_tasks;
drop policy if exists "field roles can create tasks" on public.project_tasks;
drop policy if exists "admins and related users can update tasks" on public.project_tasks;
drop policy if exists "admins and creators can delete tasks" on public.project_tasks;

create policy "members can view coworker profiles"
on public.profiles for select
using (
  id = auth.uid()
  or exists (
    select 1
    from public.company_members own_member
    join public.company_members coworker_member on coworker_member.company_id = own_member.company_id
    where own_member.user_id = auth.uid()
      and own_member.is_active = true
      and coworker_member.user_id = profiles.id
      and coworker_member.is_active = true
  )
);

create policy "visible task users can read tasks"
on public.project_tasks for select
using (
  public.has_company_role(company_id, array['owner', 'admin']::public.member_role[])
  or created_by = auth.uid()
  or assigned_to = auth.uid()
);

create policy "field roles can create tasks"
on public.project_tasks for insert
with check (
  public.has_company_role(company_id, array['owner', 'admin', 'engineer', 'brigadier', 'installer']::public.member_role[])
  and (assigned_to is null or exists (
    select 1 from public.company_members assignee
    where assignee.company_id = project_tasks.company_id
      and assignee.user_id = project_tasks.assigned_to
      and assignee.is_active = true
  ))
);

create policy "admins and related users can update tasks"
on public.project_tasks for update
using (
  public.has_company_role(company_id, array['owner', 'admin']::public.member_role[])
  or created_by = auth.uid()
  or assigned_to = auth.uid()
)
with check (
  public.has_company_role(company_id, array['owner', 'admin', 'engineer', 'brigadier', 'installer']::public.member_role[])
  and (
    public.has_company_role(company_id, array['owner', 'admin']::public.member_role[])
    or created_by = auth.uid()
    or assigned_to = auth.uid()
  )
  and (assigned_to is null or exists (
    select 1 from public.company_members assignee
    where assignee.company_id = project_tasks.company_id
      and assignee.user_id = project_tasks.assigned_to
      and assignee.is_active = true
  ))
);

create policy "admins and creators can delete tasks"
on public.project_tasks for delete
using (
  public.has_company_role(company_id, array['owner', 'admin']::public.member_role[])
  or created_by = auth.uid()
);
