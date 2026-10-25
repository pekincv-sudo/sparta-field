-- SPARTA field: immutable cash journal (USD / UAH, integer minor units).
-- Run in Supabase SQL Editor after the existing company/project schema.
-- This migration creates structure and policies only; it does not import money.
-- Dependencies: public.companies, public.projects (company_id, client_id),
-- public.member_role, public.has_company_role(uuid, public.member_role[]), auth.uid().

begin;
alter table public.projects add column if not exists currency text not null default 'UAH' check(currency in ('USD','UAH'));
alter table public.projects alter column currency set default 'USD';

create table if not exists public.cash_transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_client_id text,
  project_title text not null default '',
  direction text not null check (direction in ('income', 'expense')),
  category text not null check (category in (
    'client_payment', 'client_refund', 'labor', 'materials',
    'other_income', 'other_expense', 'opening_balance'
  )),
  amount_minor bigint not null check (amount_minor between 1 and 9007199254740991),
  counterparty text not null check (length(btrim(counterparty)) > 0),
  purpose text not null check (length(btrim(purpose)) > 0),
  occurred_at timestamptz not null default now(),
  payment_method text not null default 'cash'
    check (payment_method in ('cash', 'bank', 'card')),
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  reverses_id uuid unique references public.cash_transactions(id),
  check (reverses_id is null or reverses_id <> id),
  check (project_client_id is null or length(btrim(project_client_id)) > 0),
  check (project_client_id is null or length(btrim(project_title)) > 0)
);

-- Adding the column preserves legacy rows without UPDATE of immutable history.
alter table public.cash_transactions add column if not exists currency text not null default 'UAH' check(currency in ('USD','UAH'));
-- Old clients must not silently post UAH amounts as USD.
alter table public.cash_transactions alter column currency drop default;

comment on table public.cash_transactions is
  'Append-only USD / UAH cash journal. Correct an entry by a linked opposite entry; never overwrite history.';
comment on column public.cash_transactions.amount_minor is
  'Positive amount in cents / kopiykas according to currency; direction supplies the sign. Limited to JavaScript safe integer range.';
comment on column public.cash_transactions.project_title is
  'Project name at entry creation; remains readable if the project is renamed or removed.';
comment on column public.cash_transactions.reverses_id is
  'One opposite entry cancels an original. A reversal cannot itself be reversed.';

create index if not exists cash_transactions_company_date_idx
  on public.cash_transactions (company_id, occurred_at desc, id);
create index if not exists cash_transactions_company_project_idx
  on public.cash_transactions (company_id, project_client_id);

create or replace function public.validate_cash_transaction()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  original public.cash_transactions%rowtype;
begin
  if auth.uid() is null or not public.has_company_role(
    new.company_id, array['owner', 'admin']::public.member_role[]
  ) then
    raise exception 'Only an active company owner or admin can post cash entries.'
      using errcode = '42501';
  end if;

  if new.currency is null or new.currency not in ('USD','UAH') then raise exception 'Select cash currency: USD or UAH'; end if;

  -- Audit identity/time come from the database, never from a browser payload.
  new.created_by := auth.uid();
  new.created_at := statement_timestamp();
  new.counterparty := btrim(new.counterparty);
  new.purpose := btrim(new.purpose);
  new.project_title := btrim(coalesce(new.project_title, ''));
  if new.project_client_id is not null then
    new.project_client_id := btrim(new.project_client_id);
  end if;

  if new.reverses_id is not null then
    select * into original
    from public.cash_transactions
    where id = new.reverses_id;

    if not found then
      raise exception 'Original cash entry was not found or is not accessible.';
    end if;
    if original.reverses_id is not null then
      raise exception 'A reversal cannot itself be reversed.';
    end if;
    if new.company_id is distinct from original.company_id
      or new.project_client_id is distinct from original.project_client_id
      or new.project_title is distinct from original.project_title
      or new.category is distinct from original.category
      or new.currency is distinct from original.currency
      or new.amount_minor is distinct from original.amount_minor
      or new.payment_method is distinct from original.payment_method
      or new.direction is distinct from (case original.direction
        when 'income' then 'expense' else 'income' end)
    then
      raise exception 'A reversal must preserve company, project, category, amount and payment method, with the opposite direction.';
    end if;

    -- The unique reverses_id constraint also prevents concurrent double reversals.
    -- A removed project may still be reversed using its original snapshot.
  else
    if (new.category in ('client_payment', 'other_income', 'opening_balance')
          and new.direction <> 'income')
      or (new.category in ('client_refund', 'labor', 'materials', 'other_expense')
          and new.direction <> 'expense')
    then
      raise exception 'Cash category does not match its direction.';
    end if;

    if new.project_client_id is not null and exists (select 1 from public.projects p where p.company_id=new.company_id and p.client_id=new.project_client_id and p.currency<>new.currency) then raise exception 'Cash currency must match project currency; currencies are accounted separately'; end if;
    if new.project_client_id is not null and not exists (
      select 1 from public.projects p
      where p.company_id = new.company_id
        and p.client_id = new.project_client_id
    ) then
      raise exception 'The selected project does not belong to this company or has not been synchronized.';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.reject_cash_transaction_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'Cash history is immutable. Post a linked reversal instead.'
    using errcode = '55000';
end;
$$;

revoke all on function public.validate_cash_transaction() from public, anon;
revoke all on function public.reject_cash_transaction_mutation() from public, anon;
grant execute on function public.validate_cash_transaction() to authenticated;
grant execute on function public.reject_cash_transaction_mutation() to authenticated;

drop trigger if exists cash_transactions_validate_insert on public.cash_transactions;
create trigger cash_transactions_validate_insert
before insert on public.cash_transactions
for each row execute function public.validate_cash_transaction();

-- Statement-level defense also covers TRUNCATE and API service-role writes.
drop trigger if exists cash_transactions_immutable on public.cash_transactions;
create trigger cash_transactions_immutable
before update or delete or truncate on public.cash_transactions
for each statement execute function public.reject_cash_transaction_mutation();

alter table public.cash_transactions enable row level security;

-- A restrictive guard keeps owner/admin scope even if another permissive
-- policy is added by a later migration.
drop policy if exists "cash company scope guard" on public.cash_transactions;
create policy "cash company scope guard"
on public.cash_transactions as restrictive for all to authenticated
using (public.has_company_role(company_id, array['owner', 'admin']::public.member_role[]))
with check (public.has_company_role(company_id, array['owner', 'admin']::public.member_role[]));

drop policy if exists "cash owners can read" on public.cash_transactions;
create policy "cash owners can read"
on public.cash_transactions for select to authenticated
using (public.has_company_role(company_id, array['owner', 'admin']::public.member_role[]));

drop policy if exists "cash owners can insert" on public.cash_transactions;
create policy "cash owners can insert"
on public.cash_transactions for insert to authenticated
with check (
  created_by = auth.uid()
  and public.has_company_role(company_id, array['owner', 'admin']::public.member_role[])
);

-- The browser has only append/read access. No update/delete policies exist.
revoke all on public.cash_transactions from public, anon, authenticated;
grant select, insert on public.cash_transactions to authenticated;
revoke update, delete, truncate, references, trigger on public.cash_transactions from service_role;

commit;
