-- SPARTA field: company user access rules.
-- Run in Supabase SQL Editor when you want only the owner to manage users and invitations.

drop policy if exists "owners manage company members" on public.company_members;
drop policy if exists "owners can manage invitations" on public.company_invitations;

create policy "owners manage company members"
on public.company_members for all
using (public.has_company_role(company_id, array['owner']::public.member_role[]))
with check (public.has_company_role(company_id, array['owner']::public.member_role[]));

create policy "owners can manage invitations"
on public.company_invitations for all
using (public.has_company_role(company_id, array['owner']::public.member_role[]))
with check (public.has_company_role(company_id, array['owner']::public.member_role[]));
