-- User invitation flow with employee names.
-- Run after the main schema. Lets an authenticated user accept a company invitation by email.

alter table public.company_invitations
add column if not exists full_name text not null default '';

create or replace function public.accept_company_invitation()
returns table(company_id uuid, role public.member_role)
language plpgsql
security definer
set search_path = public
as $$
declare
  invitation_row public.company_invitations%rowtype;
  current_email text;
begin
  current_email := lower(coalesce(auth.email(), ''));

  if auth.uid() is null or current_email = '' then
    raise exception 'Authentication is required';
  end if;

  select *
  into invitation_row
  from public.company_invitations
  where lower(email) = current_email
    and accepted_at is null
  order by created_at desc
  limit 1;

  if invitation_row.id is null then
    return;
  end if;

  insert into public.profiles (id, email, full_name)
  values (auth.uid(), current_email, coalesce(nullif(invitation_row.full_name, ''), current_email))
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(nullif(excluded.full_name, ''), public.profiles.full_name);

  insert into public.company_members (company_id, user_id, role, is_active)
  values (invitation_row.company_id, auth.uid(), invitation_row.role, true)
  on conflict (company_id, user_id) do update set
    role = excluded.role,
    is_active = true;

  update public.company_invitations
  set accepted_at = now()
  where id = invitation_row.id
    and accepted_at is null;

  return query select invitation_row.company_id, invitation_row.role;
end;
$$;

grant execute on function public.accept_company_invitation() to authenticated;
