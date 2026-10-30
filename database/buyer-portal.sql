-- SPARTA external repeat buyers. Apply after database/team-build36.sql.
-- Buyers are deliberately NOT staff company_members. No account, stock, mail or
-- payment is seeded by this migration. Existing warehouse documents stay intact.
begin;

create table if not exists public.buyer_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name text not null check (length(btrim(name)) between 1 and 300),
  email text not null check (email=lower(btrim(email)) and length(email)<=254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
  phone text not null default '' check (length(phone)<=80),
  price_type text not null default 'installer' check(price_type in ('retail','installer','wholesale')),
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,email), unique(id,company_id)
);
alter table public.buyer_accounts add column if not exists price_type text not null default 'installer' check(price_type in ('retail','installer','wholesale'));
create table if not exists public.buyer_members (
  buyer_id uuid not null references public.buyer_accounts(id),
  user_id uuid not null references auth.users(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key(buyer_id,user_id)
);
create index if not exists buyer_members_user_idx on public.buyer_members(user_id,buyer_id);
create table if not exists public.buyer_invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  buyer_id uuid not null,
  email text not null,
  full_name text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id),
  revoked_at timestamptz,
  last_delivery_attempt_at timestamptz,
  last_delivery_actor uuid references auth.users(id),
  last_sent_at timestamptz,
  last_sent_by uuid references auth.users(id),
  last_send_status text not null default 'unsent' check(last_send_status in ('unsent','sending','sent','failed')),
  foreign key(buyer_id,company_id) references public.buyer_accounts(id,company_id)
);
create index if not exists buyer_invitations_email_idx on public.buyer_invitations(lower(email),expires_at);
create unique index if not exists buyer_invitations_pending_idx on public.buyer_invitations(buyer_id)
  where accepted_at is null and revoked_at is null;
create table if not exists public.buyer_orders (
  id uuid primary key default gen_random_uuid(),
  number text not null default ('SP-'||to_char(current_date,'YYMMDD')||'-'||upper(substr(gen_random_uuid()::text,1,8))),
  company_id uuid not null,
  buyer_id uuid not null,
  buyer_name text not null,
  status text not null default 'submitted' check(status in ('submitted','confirmed','ready','completed','cancelled')),
  currency text not null check(currency in ('USD','UAH')),
  price_type text default 'installer' check(price_type in ('retail','installer','wholesale')),
  -- Historical direct sales may legitimately have a recorded zero price.
  -- The portal submit RPC still requires strictly positive installer prices.
  total numeric(16,2) not null constraint buyer_orders_total_check check(total>=0 and total<=999999999999),
  delivery_method text not null check(delivery_method in ('pickup','delivery')),
  address text not null default '',
  phone text not null,
  comment text not null default '',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  warehouse_document_id text,
  warehouse_document_number text,
  foreign key(buyer_id,company_id) references public.buyer_accounts(id,company_id),
  unique(company_id,number),unique(id,company_id)
);
create index if not exists buyer_orders_buyer_idx on public.buyer_orders(buyer_id,created_at desc,id);
create index if not exists buyer_orders_company_idx on public.buyer_orders(company_id,created_at desc,id);
alter table public.buyer_orders add column if not exists warehouse_document_number text;
alter table public.buyer_orders add column if not exists price_type text default 'installer' check(price_type in ('retail','installer','wholesale'));
create unique index if not exists buyer_orders_warehouse_document_idx on public.buyer_orders(company_id,warehouse_document_id)
  where warehouse_document_id is not null;
create table if not exists public.buyer_order_lines (
  order_id uuid not null references public.buyer_orders(id),
  position integer not null check(position between 1 and 100),
  item_id text not null,
  sku text not null,
  name text not null,
  unit text not null,
  qty numeric(16,3) not null check(qty>0),
  unit_price numeric(16,2) not null constraint buyer_order_lines_unit_price_check check(unit_price>=0),
  currency text not null check(currency in ('USD','UAH')),
  line_total numeric(16,2) not null constraint buyer_order_lines_line_total_check check(line_total>=0 and line_total=round(qty*unit_price,2)),
  primary key(order_id,position)
);
-- Safe when this feature migration was previously staged/applied without the
-- historical-link extension. Duplicate item lines are valid old sale snapshots;
-- new portal submissions continue to reject duplicates before any insert.
alter table public.buyer_orders drop constraint if exists buyer_orders_total_check;
alter table public.buyer_orders add constraint buyer_orders_total_check check(total>=0 and total<=999999999999);
alter table public.buyer_order_lines drop constraint if exists buyer_order_lines_unit_price_check;
alter table public.buyer_order_lines add constraint buyer_order_lines_unit_price_check check(unit_price>=0);
alter table public.buyer_order_lines drop constraint if exists buyer_order_lines_line_total_check;
alter table public.buyer_order_lines drop constraint if exists buyer_order_lines_check;
alter table public.buyer_order_lines add constraint buyer_order_lines_line_total_check check(line_total>=0 and line_total=round(qty*unit_price,2));
alter table public.buyer_order_lines drop constraint if exists buyer_order_lines_order_id_item_id_key;
-- These holds never enter the editable project-reservations JSON array.
create table if not exists public.buyer_stock_holds (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  order_id uuid not null,
  item_id text not null,
  qty numeric(16,3) not null check(qty>0),
  created_at timestamptz not null default now(),
  foreign key(order_id,company_id) references public.buyer_orders(id,company_id),
  unique(order_id,item_id)
);
create index if not exists buyer_stock_holds_stock_idx on public.buyer_stock_holds(company_id,item_id);
create table if not exists public.buyer_requests (
  company_id uuid not null references public.companies(id),
  user_id uuid not null references auth.users(id),
  request_id uuid not null,
  purpose text not null,
  resource_id uuid not null,
  payload_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key(company_id,user_id,request_id)
);

create or replace function public.sparta_buyer_require_user()
returns uuid language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then
    raise exception 'A confirmed email account is required' using errcode='42501';
  end if;
  return auth.uid();
end $$;
create or replace function public.sparta_buyer_is_member(p_buyer_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.buyer_members m join public.buyer_accounts b on b.id=m.buyer_id
    join auth.users u on u.id=m.user_id where m.buyer_id=p_buyer_id and m.user_id=auth.uid()
    and m.is_active and b.is_active and u.email_confirmed_at is not null);
$$;
create or replace function public.sparta_buyer_require_member(p_buyer_id uuid)
returns public.buyer_accounts language plpgsql stable security definer set search_path='' as $$
declare account public.buyer_accounts%rowtype;
begin
  perform public.sparta_buyer_require_user();
  if not public.sparta_buyer_is_member(p_buyer_id) then raise exception 'Active buyer access required' using errcode='42501'; end if;
  select * into account from public.buyer_accounts where id=p_buyer_id;
  return account;
end $$;
create or replace function public.sparta_buyer_account_json(p_buyer_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',b.id,'companyId',b.company_id,'companyName',c.name,
    'name',b.name,'email',b.email,'phone',b.phone,'priceType',b.price_type,'isActive',b.is_active,'createdAt',b.created_at)
  from public.buyer_accounts b join public.companies c on c.id=b.company_id where b.id=p_buyer_id;
$$;
create or replace function public.sparta_buyer_invitation_json(p_invitation public.buyer_invitations)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('id',p_invitation.id,'status',case when p_invitation.revoked_at is not null then 'revoked'
    when p_invitation.accepted_at is not null then 'accepted' when p_invitation.expires_at<=now() then 'expired' else 'pending' end,
    'lastSendStatus',p_invitation.last_send_status,'lastSentAt',p_invitation.last_sent_at,'expiresAt',p_invitation.expires_at);
$$;
create or replace function public.sparta_buyer_order_json(p_order_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',o.id,'number',o.number,'buyerId',o.buyer_id,'buyerName',o.buyer_name,
    'companyId',o.company_id,'status',o.status,'currency',o.currency,'priceType',o.price_type,'total',o.total,
    'createdAt',o.created_at,'updatedAt',o.updated_at,'deliveryMethod',o.delivery_method,
    'address',o.address,'phone',o.phone,'comment',o.comment,'warehouseDocumentId',o.warehouse_document_id,'warehouseDocumentNumber',o.warehouse_document_number,
    'lines',coalesce((select jsonb_agg(jsonb_build_object('itemId',l.item_id,'sku',l.sku,'name',l.name,'unit',l.unit,
      'qty',l.qty,'unitPrice',l.unit_price,'currency',l.currency,'lineTotal',l.line_total) order by l.position)
      from public.buyer_order_lines l where l.order_id=o.id),'[]'::jsonb))
  from public.buyer_orders o where o.id=p_order_id;
$$;

-- Neither a staff first-write nor a buyer first-read may manufacture an
-- installer price from retail. This changes only the legacy seeding function;
-- already-authoritative workspace values remain exactly as recorded.
create or replace function public.sparta_warehouse_legacy_state(p_company_id uuid)
returns jsonb language sql volatile security definer set search_path='' as $$
  select jsonb_build_object('version',1,'items',coalesce(jsonb_agg(
    jsonb_build_object('id',w.client_item_id,'name',w.name,'category',w.category,
      'sku',coalesce(w.sku,''),'unit',w.unit,'qty',w.quantity,
      'purchasePrice',w.purchase_price,'retailPrice',w.sale_price,'salePrice',w.sale_price,
      'installerPrice',0,'wholesalePrice',0,'deliveryCost',0,'extraCost',0,
      'minQty',w.min_quantity,'location',coalesce(w.location,''))||w.app_data
    order by w.created_at,w.id) filter(where w.id is not null),'[]'::jsonb),
    'movements','[]'::jsonb,'documents','[]'::jsonb,'reservations','[]'::jsonb)
  from public.warehouse_items w where w.company_id=p_company_id;
$$;
revoke all on function public.sparta_warehouse_legacy_state(uuid) from public,anon,authenticated,service_role;

-- Buyer-safe reads are also correct before a workspace row has been created.
create or replace function public.sparta_buyer_workspace_state(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  select state into result from public.warehouse_workspaces where company_id=p_company_id;
  if result is not null then return result; end if;
  result:=public.sparta_warehouse_legacy_state(p_company_id);
  return jsonb_set(result,'{items}',coalesce((select jsonb_agg(x.value||jsonb_build_object('installerPrice',
    coalesce(w.app_data->'installerPrice','0'::jsonb),'wholesalePrice',coalesce(w.app_data->'wholesalePrice','0'::jsonb)) order by x.ordinality)
    from jsonb_array_elements(result->'items') with ordinality x(value,ordinality)
    join public.warehouse_items w on w.company_id=p_company_id and w.client_item_id=x.value->>'id'),'[]'::jsonb));
end $$;
create or replace function public.sparta_buyer_lock_workspace(p_company_id uuid)
returns public.warehouse_workspaces language plpgsql security definer set search_path='' as $$
declare result public.warehouse_workspaces%rowtype;
begin
  insert into public.warehouse_workspaces(company_id,state)
    values(p_company_id,public.sparta_buyer_workspace_state(p_company_id)) on conflict do nothing;
  select * into result from public.warehouse_workspaces where company_id=p_company_id for update;
  return result;
end $$;
create or replace function public.sparta_buyer_stock_item(p_item jsonb)
returns boolean language sql immutable set search_path='' as $$
  select p_item is not null and coalesce(p_item->>'type','')<>'service' and coalesce(p_item->>'isStockItem','true')<>'false'
    and lower(btrim(coalesce(p_item->>'category',''))) not in
      ('роботи','робота','послуги','послуга','витрати','витрата','зарплата','services','expenses')
    and coalesce(p_item->>'archived','false')<>'true';
$$;
create or replace function public.sparta_buyer_available(p_company_id uuid,p_state jsonb,p_item_id text)
returns numeric language sql stable security definer set search_path='' as $$
  select greatest(0,coalesce((select public.sparta_warehouse_number(i->'qty') from jsonb_array_elements(p_state->'items') i where i->>'id'=p_item_id),0)
    -coalesce((select sum(public.sparta_warehouse_number(r->'qty')) from jsonb_array_elements(p_state->'reservations') r where r->>'itemId'=p_item_id),0)
    -coalesce((select sum(h.qty) from public.buyer_stock_holds h where h.company_id=p_company_id and h.item_id=p_item_id),0));
$$;
-- The caller's active account chooses one fixed field. A buyer-supplied price
-- type never participates, and missing installer/wholesale prices never use
-- retail. The salePrice alias is a legacy alias of the RETAIL tier only.
create or replace function public.sparta_buyer_price(p_item jsonb,p_price_type text)
returns numeric language plpgsql immutable security definer set search_path='' as $$
declare price numeric; value jsonb;
begin
  value:=case p_price_type when 'retail' then coalesce(nullif(p_item->'retailPrice','null'::jsonb),p_item->'salePrice')
    when 'installer' then p_item->'installerPrice' when 'wholesale' then p_item->'wholesalePrice' else null end;
  price:=round(public.sparta_warehouse_number(value),2);
  return case when price>0 then price else null end;
exception when others then return null;
end $$;
create or replace function public.sparta_buyer_guard_warehouse()
returns trigger language plpgsql security definer set search_path='' as $$
declare hold record; item jsonb; reserved numeric;
begin
  if tg_op='DELETE' then
    if exists(select 1 from public.buyer_stock_holds where company_id=old.company_id) then raise exception 'Buyer order holds prevent deleting warehouse' using errcode='23514'; end if;
    return old;
  end if;
  -- Existing deployed warehouse writers predate wholesalePrice. This guard
  -- validates it for every server state write, including those older clients.
  for item in select value from jsonb_array_elements(new.state->'items') loop
    if public.sparta_warehouse_number(item->'wholesalePrice')<0 then
      raise exception 'Wholesale price must be nonnegative' using errcode='23514';
    end if;
  end loop;
  for hold in select item_id,sum(qty) qty from public.buyer_stock_holds where company_id=new.company_id group by item_id loop
    select value into item from jsonb_array_elements(new.state->'items') where value->>'id'=hold.item_id;
    if item is null then raise exception 'Buyer order holds prevent removing product' using errcode='23514'; end if;
    select coalesce(sum(public.sparta_warehouse_number(r->'qty')),0) into reserved
      from jsonb_array_elements(new.state->'reservations') r where r->>'itemId'=hold.item_id;
    if public.sparta_warehouse_number(item->'qty')<reserved+hold.qty then
      raise exception 'Stock is reserved for confirmed buyer orders' using errcode='23514';
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists sparta_buyer_warehouse_holds on public.warehouse_workspaces;
create trigger sparta_buyer_warehouse_holds before insert or update or delete on public.warehouse_workspaces
  for each row execute function public.sparta_buyer_guard_warehouse();

create or replace function public.sparta_buyer_snapshot_guard()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_table_name='buyer_order_lines' or tg_op='DELETE' then raise exception 'Buyer order snapshots are immutable' using errcode='55000'; end if;
  if (to_jsonb(new)-array['status','updated_at','warehouse_document_id']) is distinct from
     (to_jsonb(old)-array['status','updated_at','warehouse_document_id']) then
    raise exception 'Buyer order snapshots are immutable' using errcode='55000';
  end if;
  return new;
end $$;
drop trigger if exists sparta_buyer_order_snapshot on public.buyer_orders;
create trigger sparta_buyer_order_snapshot before update or delete on public.buyer_orders for each row execute function public.sparta_buyer_snapshot_guard();
drop trigger if exists sparta_buyer_line_snapshot on public.buyer_order_lines;
create trigger sparta_buyer_line_snapshot before update or delete on public.buyer_order_lines for each row execute function public.sparta_buyer_snapshot_guard();

do $$ begin
  if to_regprocedure('public.sparta_warehouse_staff_read(uuid)') is null then
    alter function public.sparta_warehouse_read(uuid) rename to sparta_warehouse_staff_read;
  end if;
end $$;
create or replace function public.sparta_warehouse_read(p_company_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
  result:=public.sparta_warehouse_staff_read(p_company_id);
  return result||jsonb_build_object('orderReservations',coalesce((select jsonb_agg(jsonb_build_object(
    'id',h.id,'orderId',h.order_id,'orderNumber',o.number,'itemId',h.item_id,'qty',h.qty) order by h.created_at,h.id)
    from public.buyer_stock_holds h join public.buyer_orders o on o.id=h.order_id where h.company_id=p_company_id),'[]'::jsonb));
end $$;

create or replace function public.sparta_buyer_context()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform public.sparta_buyer_require_user();
  return jsonb_build_object('accounts',coalesce((select jsonb_agg(public.sparta_buyer_account_json(b.id) order by b.created_at,b.id)
    from public.buyer_accounts b where public.sparta_buyer_is_member(b.id)),'[]'::jsonb));
end $$;
create or replace function public.sparta_buyer_catalog(p_buyer_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare account public.buyer_accounts%rowtype; state jsonb;
begin
  account:=public.sparta_buyer_require_member(p_buyer_id);
  state:=public.sparta_buyer_workspace_state(account.company_id);
  return jsonb_build_object('buyer',public.sparta_buyer_account_json(p_buyer_id),'items',coalesce((select jsonb_agg(
    jsonb_build_object('id',i->>'id','name',i->>'name','sku',coalesce(i->>'sku',''),'category',coalesce(i->>'category','Інше'),
      'brand',coalesce(i->>'brand',''),'model',coalesce(i->>'model',''),'unit',i->>'unit','currency',coalesce(i->>'currency','UAH'),
      'characteristics',coalesce(i->>'characteristics',''),
      'powerW',i->'powerW','powerKw',i->'powerKw','capacityKwh',i->'capacityKwh',
      'voltageV',i->'voltageV','phases',i->'phases','crossSectionMm2',i->'crossSectionMm2',
      'price',public.sparta_buyer_price(i,account.price_type),
      'availableQty',public.sparta_buyer_available(account.company_id,state,i->>'id')) order by i->>'category',i->>'name',i->>'id')
    from jsonb_array_elements(state->'items') i where public.sparta_buyer_stock_item(i)),'[]'::jsonb));
end $$;
create or replace function public.sparta_buyer_orders(p_buyer_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform public.sparta_buyer_require_member(p_buyer_id);
  return jsonb_build_object('orders',coalesce((select jsonb_agg(public.sparta_buyer_order_json(o.id) order by o.created_at desc,o.id)
    from public.buyer_orders o where o.buyer_id=p_buyer_id),'[]'::jsonb));
end $$;

create or replace function public.sparta_buyer_submit_order(p_buyer_id uuid,p_request_id uuid,p_lines jsonb,p_delivery jsonb,p_expected_total numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare account public.buyer_accounts%rowtype; workspace public.warehouse_workspaces%rowtype; previous public.buyer_requests%rowtype;
  request_hash text; entry jsonb; item jsonb; qty numeric; price numeric; line_total numeric; total numeric:=0;
  code text; order_currency text; lines jsonb:='[]'::jsonb; position integer:=0; new_order uuid; result jsonb;
  method text; address text; phone text; comment_text text;
begin
  account:=public.sparta_buyer_require_member(p_buyer_id);
  if p_request_id is null then raise exception 'Missing request identity'; end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines) not between 1 and 100 or octet_length(p_lines::text)>100000 then raise exception 'Select between 1 and 100 order lines'; end if;
  if p_delivery is null or jsonb_typeof(p_delivery)<>'object' or octet_length(p_delivery::text)>10000 then raise exception 'Invalid delivery details'; end if;
  request_hash:=md5(jsonb_build_object('buyerId',p_buyer_id,'lines',p_lines,'delivery',p_delivery,'expectedTotal',p_expected_total)::text);
  workspace:=public.sparta_buyer_lock_workspace(account.company_id);
  account:=public.sparta_buyer_require_member(p_buyer_id);
  -- Every request for a company is serialized by the same warehouse lock.
  select * into previous from public.buyer_requests where company_id=account.company_id and user_id=auth.uid() and request_id=p_request_id;
  if previous.request_id is not null then
    if previous.purpose<>'submit' or previous.resource_id<>p_buyer_id or previous.payload_hash<>request_hash then raise exception 'Request identity was already used for different data' using errcode='22023'; end if;
    return previous.response;
  end if;
  method:=coalesce(p_delivery->>'method','');address:=btrim(coalesce(p_delivery->>'address',''));
  phone:=btrim(coalesce(p_delivery->>'phone',account.phone));comment_text:=btrim(coalesce(p_delivery->>'comment',''));
  if method not in ('pickup','delivery') or length(address)>1000 or length(phone) not between 3 and 80 or length(comment_text)>2000
    or (method='delivery' and address='') then raise exception 'Check delivery method, address and contact phone'; end if;
  if (select count(distinct x->>'itemId') from jsonb_array_elements(p_lines) x)<>jsonb_array_length(p_lines) then raise exception 'Duplicate order product'; end if;
  for entry in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(entry)<>'object' or jsonb_typeof(entry->'itemId') is distinct from 'string' or jsonb_typeof(entry->'qty') is distinct from 'number'
      or exists(select 1 from jsonb_object_keys(entry) k where k not in ('itemId','qty')) then raise exception 'Order lines accept only itemId and numeric qty'; end if;
    select value into item from jsonb_array_elements(workspace.state->'items') where value->>'id'=entry->>'itemId';
    if not coalesce(public.sparta_buyer_stock_item(item),false) then raise exception 'Product is not available for purchase'; end if;
    qty:=public.sparta_warehouse_number(entry->'qty');
    if qty<=0 or qty<>round(qty,3) or (coalesce(item->>'unit','') ~* '^(шт[.]?|штук[аи]?|компл[.]?|комплект[и]?|pcs?|set)$' and qty<>trunc(qty)) then raise exception 'Invalid order quantity; whole units or at most three decimals required'; end if;
    if qty>public.sparta_buyer_available(account.company_id,workspace.state,item->>'id') then raise exception 'Insufficient available stock; refresh the catalog' using errcode='23514'; end if;
    price:=public.sparta_buyer_price(item,account.price_type);
    if price is null then raise exception 'Selected buyer tier price is not set for this product' using errcode='23514'; end if;
    code:=coalesce(item->>'currency','UAH');
    if code not in ('USD','UAH') or (order_currency is not null and code<>order_currency) then raise exception 'One order must use one currency'; end if;
    order_currency:=code;line_total:=round(qty*price,2);total:=total+line_total;position:=position+1;
    if line_total<=0 or total>999999999999 then raise exception 'Order total is outside supported limits'; end if;
    lines:=lines||jsonb_build_array(jsonb_build_object('itemId',item->>'id','sku',coalesce(item->>'sku',''),'name',item->>'name',
      'unit',item->>'unit','qty',qty,'unitPrice',price,'currency',code,'lineTotal',line_total,'position',position));
  end loop;
  if p_expected_total is null or p_expected_total::text !~ '^[0-9]+([.][0-9]+)?$' or p_expected_total<>total then
    raise exception 'Catalog prices changed; review the refreshed total before submitting' using errcode='22023';
  end if;
  insert into public.buyer_orders(company_id,buyer_id,buyer_name,currency,price_type,total,delivery_method,address,phone,comment,created_by)
    values(account.company_id,account.id,account.name,order_currency,account.price_type,total,method,address,phone,comment_text,auth.uid()) returning id into new_order;
  insert into public.buyer_order_lines(order_id,position,item_id,sku,name,unit,qty,unit_price,currency,line_total)
    select new_order,(l->>'position')::integer,l->>'itemId',l->>'sku',l->>'name',l->>'unit',(l->>'qty')::numeric,
      (l->>'unitPrice')::numeric,l->>'currency',(l->>'lineTotal')::numeric from jsonb_array_elements(lines) l;
  result:=jsonb_build_object('order',public.sparta_buyer_order_json(new_order));
  insert into public.buyer_requests(company_id,user_id,request_id,purpose,resource_id,payload_hash,response)
    values(account.company_id,auth.uid(),p_request_id,'submit',account.id,request_hash,result);
  perform public.sparta_audit_record(account.company_id,'order_submitted','buyer_orders',new_order::text,account.name,null,result->'order');
  return result;
end $$;

create or replace function public.sparta_buyer_change_order(p_order_id uuid,p_action text,p_request_id uuid,p_buyer_action boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.buyer_orders%rowtype; workspace public.warehouse_workspaces%rowtype; previous public.buyer_requests%rowtype;
  account public.buyer_accounts%rowtype; request_hash text; result jsonb; prior_status text; item jsonb; line record;
  state jsonb; new_items jsonb; doc_lines jsonb:='[]'::jsonb; movements jsonb:='[]'::jsonb; doc jsonb;
  unit_cost numeric; doc_id text; snapshot jsonb; held numeric; stock_request uuid; staff_roles public.member_role[];
begin
  perform public.sparta_buyer_require_user();
  if p_request_id is null or p_action is null or p_buyer_action is null then raise exception 'Missing order action identity'; end if;
  select * into target from public.buyer_orders where id=p_order_id;
  if target.id is null then raise exception 'Order access required' using errcode='42501'; end if;
  if p_buyer_action then
    perform public.sparta_buyer_require_member(target.buyer_id);
    if p_action<>'cancel' then raise exception 'Buyer may cancel a submitted order only' using errcode='42501'; end if;
  else
    staff_roles:=case when p_action in ('ready','fulfil') then array['owner','admin','warehouse']::public.member_role[]
      when p_action='confirm' then array['owner','admin','engineer']::public.member_role[]
      when p_action='cancel' then array['owner','admin','engineer','warehouse']::public.member_role[] else array[]::public.member_role[] end;
    if not public.has_company_role(target.company_id,staff_roles) then raise exception 'Staff role cannot perform this order action' using errcode='42501'; end if;
  end if;
  -- This lock order matches every generic warehouse posting: workspace FIRST.
  workspace:=public.sparta_buyer_lock_workspace(target.company_id);
  if p_buyer_action then perform public.sparta_buyer_require_member(target.buyer_id); end if;
  select * into target from public.buyer_orders where id=p_order_id for update;
  request_hash:=md5(jsonb_build_object('orderId',p_order_id,'action',p_action,'buyerAction',p_buyer_action)::text);
  select * into previous from public.buyer_requests where company_id=target.company_id and user_id=auth.uid() and request_id=p_request_id;
  if previous.request_id is not null then
    if previous.purpose<>'action' or previous.resource_id<>p_order_id or previous.payload_hash<>request_hash then raise exception 'Request identity was already used for different data' using errcode='22023'; end if;
    return previous.response;
  end if;
  prior_status:=target.status;
  if p_action='confirm' then
    if target.status<>'submitted' then raise exception 'Only submitted orders can be confirmed'; end if;
    select * into account from public.buyer_accounts where id=target.buyer_id for no key update;
    if not account.is_active then raise exception 'Buyer account is inactive' using errcode='42501'; end if;
    for line in select * from public.buyer_order_lines where order_id=target.id order by position loop
      select value into item from jsonb_array_elements(workspace.state->'items') where value->>'id'=line.item_id;
      if not coalesce(public.sparta_buyer_stock_item(item),false) or coalesce(item->>'currency','UAH')<>line.currency or item->>'unit'<>line.unit then raise exception 'Ordered product no longer matches catalog'; end if;
      if line.qty>public.sparta_buyer_available(target.company_id,workspace.state,line.item_id) then raise exception 'Insufficient available stock to confirm order' using errcode='23514'; end if;
    end loop;
    insert into public.buyer_stock_holds(company_id,order_id,item_id,qty)
      select target.company_id,target.id,item_id,qty from public.buyer_order_lines where order_id=target.id;
    update public.buyer_orders set status='confirmed',updated_at=clock_timestamp() where id=target.id;
    update public.warehouse_workspaces set revision=revision+1,updated_by=auth.uid(),updated_at=clock_timestamp() where company_id=target.company_id;
  elsif p_action='ready' then
    if target.status<>'confirmed' then raise exception 'Only confirmed orders can be marked ready'; end if;
    update public.buyer_orders set status='ready',updated_at=clock_timestamp() where id=target.id;
  elsif p_action='cancel' then
    if target.status in ('completed','cancelled') or (p_buyer_action and target.status<>'submitted') then raise exception 'This order cannot be cancelled'; end if;
    delete from public.buyer_stock_holds where order_id=target.id;
    update public.buyer_orders set status='cancelled',updated_at=clock_timestamp() where id=target.id;
    update public.warehouse_workspaces set revision=revision+1,updated_by=auth.uid(),updated_at=clock_timestamp() where company_id=target.company_id;
  elsif p_action='fulfil' then
    if target.status not in ('confirmed','ready') then raise exception 'Only confirmed or ready orders can be fulfilled'; end if;
    state:=workspace.state;doc_id:='buyer-sale-'||target.id::text;
    stock_request:=md5('sparta:buyer-sale:'||target.id::text)::uuid;
    if exists(select 1 from public.warehouse_requests where company_id=target.company_id and request_id=stock_request) then
      raise exception 'Warehouse request identity collision; order was not fulfilled' using errcode='23514';
    end if;
    for line in select * from public.buyer_order_lines where order_id=target.id order by position loop
      select qty into held from public.buyer_stock_holds where order_id=target.id and item_id=line.item_id;
      if held is distinct from line.qty then raise exception 'Confirmed order hold is missing'; end if;
      select value into item from jsonb_array_elements(state->'items') where value->>'id'=line.item_id;
      if item is null or coalesce(item->>'currency','UAH')<>line.currency or item->>'unit'<>line.unit or public.sparta_warehouse_number(item->'qty')<line.qty then raise exception 'Ordered inventory is unavailable'; end if;
      unit_cost:=public.sparta_warehouse_number(item->'purchasePrice')+public.sparta_warehouse_number(item->'deliveryCost')+public.sparta_warehouse_number(item->'extraCost');
      select jsonb_agg(case when i.value->>'id'=line.item_id then jsonb_set(i.value,'{qty}',to_jsonb(public.sparta_warehouse_number(i.value->'qty')-line.qty)) else i.value end order by i.ordinality)
        into new_items from jsonb_array_elements(state->'items') with ordinality i(value,ordinality);
      state:=jsonb_set(state,'{items}',new_items);
      -- Preserve whether acquisition cost was actually known at issue time.
      -- Imported unknown prices are stored as zero and must never become a
      -- fictitious 100% margin. This private flag is not part of buyer JSON.
      snapshot:=jsonb_build_object('currency',line.currency,'itemId',line.item_id,'itemName',line.name,'sku',line.sku,'qty',line.qty,'unit',line.unit,'unitCost',unit_cost,
        'unitCostKnown',case when item ? 'purchasePriceKnown' then item->'purchasePriceKnown'='true'::jsonb
          else jsonb_typeof(item->'purchasePrice')='number' and public.sparta_warehouse_number(item->'purchasePrice')>0 end,
        'salePrice',line.unit_price);
      doc_lines:=doc_lines||jsonb_build_array(snapshot);
      movements:=movements||jsonb_build_array(snapshot||jsonb_build_object('id','buyer-move-'||target.id::text||'-'||line.position,
        'type','sale','projectId','','customer',target.buyer_name,'buyerOrderId',target.id,'documentId',doc_id,'documentNumber',target.number,
        'createdAt',clock_timestamp(),'createdBy',auth.uid(),'note','Замовлення покупця '||target.number));
    end loop;
    doc:=jsonb_build_object('id',doc_id,'number',target.number,'type','sale','status','posted','currency',target.currency,
      'date',to_char(clock_timestamp() at time zone 'Europe/Kyiv','YYYY-MM-DD'),'customer',target.buyer_name,'buyerOrderId',target.id,
      'createdAt',clock_timestamp(),'createdBy',auth.uid(),'lines',doc_lines,'attachments','[]'::jsonb,'note','Замовлення покупця '||target.number);
    state:=jsonb_set(jsonb_set(state,'{documents}',jsonb_build_array(doc)||coalesce(state->'documents','[]'::jsonb)),
      '{movements}',movements||coalesce(state->'movements','[]'::jsonb));
    -- Remove only this order's holds before the common writer checks remaining
    -- project + buyer reservations. Any failure rolls back holds and journal.
    delete from public.buyer_stock_holds where order_id=target.id;
    perform public.sparta_warehouse_write(target.company_id,stock_request,workspace.revision,state,'[]'::jsonb);
    update public.buyer_orders set status='completed',warehouse_document_id=doc_id,updated_at=clock_timestamp() where id=target.id;
  else
    raise exception 'Unsupported order action';
  end if;
  result:=jsonb_build_object('order',public.sparta_buyer_order_json(target.id));
  insert into public.buyer_requests(company_id,user_id,request_id,purpose,resource_id,payload_hash,response)
    values(target.company_id,auth.uid(),p_request_id,'action',target.id,request_hash,result);
  perform public.sparta_audit_record(target.company_id,'order_'||p_action,'buyer_orders',target.id::text,target.number,
    jsonb_build_object('status',prior_status),result->'order');
  return result;
end $$;
create or replace function public.sparta_buyer_cancel_order(p_order_id uuid,p_request_id uuid)
returns jsonb language sql security definer set search_path='' as $$
  select public.sparta_buyer_change_order(p_order_id,'cancel',p_request_id,true);
$$;
create or replace function public.sparta_sales_order_action(p_order_id uuid,p_action text,p_request_id uuid)
returns jsonb language sql security definer set search_path='' as $$
  select public.sparta_buyer_change_order(p_order_id,p_action,p_request_id,false);
$$;
create or replace function public.sparta_sales_orders(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform public.sparta_buyer_require_user();
  if not public.has_company_role(p_company_id,array['owner','admin','engineer','warehouse']::public.member_role[]) then raise exception 'Sales staff access required' using errcode='42501'; end if;
  return jsonb_build_object('orders',coalesce((select jsonb_agg(public.sparta_buyer_order_json(o.id) order by o.created_at desc,o.id)
    from public.buyer_orders o where o.company_id=p_company_id),'[]'::jsonb));
end $$;
create or replace function public.sparta_sales_buyers(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform public.sparta_buyer_require_user();
  if not public.has_company_role(p_company_id,array['owner','admin','engineer','warehouse']::public.member_role[]) then raise exception 'Sales staff access required' using errcode='42501'; end if;
  return jsonb_build_object('buyers',coalesce((select jsonb_agg(public.sparta_buyer_account_json(b.id)||jsonb_build_object('invitation',
    (select public.sparta_buyer_invitation_json(i) from public.buyer_invitations i where i.buyer_id=b.id order by i.created_at desc,i.id desc limit 1))
    order by b.created_at desc,b.id) from public.buyer_accounts b where b.company_id=p_company_id),'[]'::jsonb));
end $$;
create or replace function public.sparta_sales_save_buyer(p_company_id uuid,p_buyer jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare account public.buyer_accounts%rowtype; previous jsonb; invitation public.buyer_invitations%rowtype;
  requested_id uuid; name_text text; email_text text; phone_text text; tier text; active boolean;
begin
  perform public.sparta_buyer_require_user();
  if not public.has_company_role(p_company_id,array['owner','admin']::public.member_role[]) then raise exception 'Buyer access is managed by owner or admin' using errcode='42501'; end if;
  if p_buyer is null or jsonb_typeof(p_buyer)<>'object' or octet_length(p_buyer::text)>10000 then raise exception 'Invalid buyer details'; end if;
  requested_id:=nullif(p_buyer->>'id','')::uuid;
  name_text:=btrim(coalesce(p_buyer->>'name',''));email_text:=lower(btrim(coalesce(p_buyer->>'email','')));phone_text:=btrim(coalesce(p_buyer->>'phone',''));
  if length(name_text) not between 1 and 300 or length(email_text)>254 or email_text !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or length(phone_text)>80
    or (p_buyer ? 'isActive' and jsonb_typeof(p_buyer->'isActive')<>'boolean') then raise exception 'Check buyer name, email and phone'; end if;
  if p_buyer ? 'priceType' and (jsonb_typeof(p_buyer->'priceType')<>'string' or p_buyer->>'priceType' not in ('retail','installer','wholesale')) then
    raise exception 'Buyer price type must be retail, installer or wholesale';
  end if;
  -- NO KEY UPDATE stays compatible with the company/buyer FK KEY SHARE locks
  -- held by order submissions. FOR UPDATE here creates a company/account cycle.
  perform 1 from public.companies where id=p_company_id for no key update;
  if requested_id is not null then
    select * into account from public.buyer_accounts where id=requested_id and company_id=p_company_id for no key update;
    if account.id is null then raise exception 'Buyer company access required' using errcode='42501'; end if;
    if account.email<>email_text then raise exception 'Buyer email is immutable; create a separate account for a different buyer'; end if;
    previous:=public.sparta_buyer_account_json(account.id);active:=coalesce((p_buyer->>'isActive')::boolean,account.is_active);tier:=coalesce(p_buyer->>'priceType',account.price_type);
    update public.buyer_accounts set name=name_text,phone=phone_text,price_type=tier,is_active=active,updated_at=clock_timestamp() where id=account.id returning * into account;
  else
    active:=coalesce((p_buyer->>'isActive')::boolean,true);tier:=coalesce(p_buyer->>'priceType','installer');
    insert into public.buyer_accounts(company_id,name,email,phone,price_type,is_active,created_by)
      values(p_company_id,name_text,email_text,phone_text,tier,active,auth.uid()) returning * into account;
  end if;
  if not account.is_active then
    update public.buyer_invitations set revoked_at=clock_timestamp() where buyer_id=account.id and accepted_at is null and revoked_at is null;
  elsif not exists(select 1 from public.buyer_members m join auth.users u on u.id=m.user_id
    where m.buyer_id=account.id and m.is_active and lower(u.email)=account.email and u.email_confirmed_at is not null) then
    select * into invitation from public.buyer_invitations where buyer_id=account.id and accepted_at is null and revoked_at is null for update;
    if invitation.id is not null and invitation.expires_at<=now() then
      update public.buyer_invitations set revoked_at=clock_timestamp() where id=invitation.id;invitation:=null;
    end if;
    if invitation.id is null then
      insert into public.buyer_invitations(company_id,buyer_id,email,full_name,created_by)
        values(p_company_id,account.id,account.email,account.name,auth.uid()) returning * into invitation;
    else
      update public.buyer_invitations set full_name=account.name where id=invitation.id returning * into invitation;
    end if;
  end if;
  perform public.sparta_audit_record(p_company_id,case when previous is null then 'create' else 'update' end,'buyer_accounts',account.id::text,account.name,
    previous,public.sparta_buyer_account_json(account.id));
  return jsonb_build_object('buyer',public.sparta_buyer_account_json(account.id),'invitation',
    case when invitation.id is not null then public.sparta_buyer_invitation_json(invitation) else null end);
end $$;

create or replace function public.sparta_buyer_accept_invitation()
returns boolean language plpgsql security definer set search_path='' as $$
declare verified_email text; invitation public.buyer_invitations%rowtype; account public.buyer_accounts%rowtype; accepted boolean:=false; candidate record;
begin
  perform public.sparta_buyer_require_user();
  select lower(email) into verified_email from auth.users where id=auth.uid();
  for candidate in select distinct i.buyer_id from public.buyer_invitations i join public.buyer_accounts b on b.id=i.buyer_id
    where lower(i.email)=verified_email and i.accepted_at is null and i.revoked_at is null and i.expires_at>now() and b.is_active order by i.buyer_id loop
    select * into account from public.buyer_accounts where id=candidate.buyer_id for no key update;
    select * into invitation from public.buyer_invitations where buyer_id=account.id and email=verified_email and accepted_at is null and revoked_at is null and expires_at>now() for update;
    if invitation.id is null or not account.is_active or account.email<>verified_email then continue; end if;
    insert into public.buyer_members(buyer_id,user_id,is_active) values(account.id,auth.uid(),true)
      on conflict(buyer_id,user_id) do update set is_active=true;
    update public.buyer_invitations set accepted_at=clock_timestamp(),accepted_by=auth.uid() where id=invitation.id;
    perform public.sparta_audit_record(account.company_id,'buyer_invite_accept','buyer_invitations',invitation.id::text,account.name,null,
      jsonb_build_object('buyerId',account.id,'userId',auth.uid()));
    accepted:=true;
  end loop;
  return accepted;
end $$;
create or replace function public.sparta_buyer_prepare_invitation_email(p_invitation_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare invitation public.buyer_invitations%rowtype; account public.buyer_accounts%rowtype; target uuid;
begin
  select buyer_id into target from public.buyer_invitations where id=p_invitation_id;
  select * into account from public.buyer_accounts where id=target for no key update;
  select * into invitation from public.buyer_invitations where id=p_invitation_id for update;
  if invitation.id is null or not coalesce(account.is_active,false) or invitation.email<>account.email or invitation.accepted_at is not null or invitation.revoked_at is not null or invitation.expires_at<=now()
    or not exists(select 1 from public.company_members m join auth.users u on u.id=m.user_id where m.company_id=invitation.company_id and m.user_id=p_actor_id and m.is_active and m.role in ('owner','admin') and u.email_confirmed_at is not null) then
    raise exception 'A pending buyer invitation and authorized sender are required' using errcode='42501';
  end if;
  if invitation.last_delivery_attempt_at>clock_timestamp()-interval '60 seconds' then raise exception 'Invitation email cooldown: wait 60 seconds'; end if;
  update public.buyer_invitations set last_delivery_attempt_at=clock_timestamp(),last_delivery_actor=p_actor_id,last_send_status='sending' where id=invitation.id returning * into invitation;
  return jsonb_build_object('id',invitation.id,'company_id',invitation.company_id,'buyer_id',invitation.buyer_id,'email',invitation.email,'full_name',invitation.full_name,
    'expires_at',invitation.expires_at,'accepted_at',invitation.accepted_at,'revoked_at',invitation.revoked_at);
end $$;
create or replace function public.sparta_buyer_record_invitation_delivery(p_invitation_id uuid,p_actor_id uuid,p_succeeded boolean,p_mode text)
returns void language plpgsql security definer set search_path='' as $$
declare invitation public.buyer_invitations%rowtype; account public.buyer_accounts%rowtype; target uuid;
begin
  select buyer_id into target from public.buyer_invitations where id=p_invitation_id;
  select * into account from public.buyer_accounts where id=target for no key update;
  select * into invitation from public.buyer_invitations where id=p_invitation_id for update;
  if invitation.id is null or not coalesce(account.is_active,false) or p_succeeded is null or p_mode is null or p_mode not in ('invite','recovery')
    or invitation.last_send_status<>'sending' or invitation.last_delivery_actor is distinct from p_actor_id
    or not exists(select 1 from public.company_members m join auth.users u on u.id=m.user_id where m.company_id=invitation.company_id and m.user_id=p_actor_id and m.is_active and m.role in ('owner','admin') and u.email_confirmed_at is not null) then
    raise exception 'Authorized buyer delivery report required' using errcode='42501';
  end if;
  update public.buyer_invitations set last_send_status=case when p_succeeded then 'sent' else 'failed' end,
    last_sent_at=case when p_succeeded then clock_timestamp() else last_sent_at end,last_sent_by=p_actor_id where id=invitation.id;
  perform public.sparta_audit_record(invitation.company_id,case when p_succeeded then 'buyer_invitation_sent' else 'buyer_invitation_delivery_failed' end,
    'buyer_invitations',invitation.id::text,invitation.full_name,null,jsonb_build_object('email',invitation.email,'mode',p_mode),p_actor_id);
end $$;

-- Historical phone/direct purchases are linked explicitly by staff. The source
-- is an immutable posted SALE document, never today's catalog price/cost. The
-- projection also lists incomplete old documents without inventing a price.
create or replace function public.sparta_buyer_sale_snapshot(p_document jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; line jsonb; lines jsonb:='[]'::jsonb; code text; line_code text; qty numeric; price numeric;
  amount numeric; total numeric:=0; position integer:=0; date_text text; document_id text; item_id text; name_text text; unit_text text;
begin
  code:=case when jsonb_typeof(p_document->'currency')='string' then coalesce(nullif(p_document->>'currency',''),'UAH') else 'UAH' end;
  date_text:=coalesce(case when jsonb_typeof(p_document->'date')='string' then nullif(p_document->>'date','') end,
    case when jsonb_typeof(p_document->'createdAt')='string' then nullif(left(p_document->>'createdAt',10),'') end,
    case when jsonb_typeof(p_document->'recordedAt')='string' then nullif(left(p_document->>'recordedAt',10),'') end);
  document_id:=case when jsonb_typeof(p_document->'id')='string' then p_document->>'id' else '' end;
  result:=jsonb_build_object('id',document_id,
    'number',case when jsonb_typeof(p_document->'number')='string' then coalesce(nullif(p_document->>'number',''),document_id) else document_id end,
    'date',date_text,'customer',case when jsonb_typeof(p_document->'customer')='string' then p_document->>'customer' else '' end,'currency',code,
    'total',null,'lines','[]'::jsonb);
  if p_document->>'type' is distinct from 'sale' or p_document->>'status' is distinct from 'posted'
    or jsonb_typeof(p_document->'id') is distinct from 'string' or coalesce(p_document->>'id','')='' or code not in ('USD','UAH')
    or (p_document ? 'currency' and jsonb_typeof(p_document->'currency')<>'string') or date_text is null or date_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or jsonb_typeof(p_document->'lines') is distinct from 'array' or jsonb_array_length(p_document->'lines') not between 1 and 100 then
    raise exception 'Historical sale snapshot is incomplete';
  end if;
  if to_char(date_text::date,'YYYY-MM-DD')<>date_text then raise exception 'Historical sale date is invalid'; end if;
  for line in select value from jsonb_array_elements(p_document->'lines') loop
    position:=position+1;
    if jsonb_typeof(line)<>'object' or not(line ? 'salePrice') or jsonb_typeof(line->'salePrice') not in ('number','string')
      or (line ? 'itemId' and jsonb_typeof(line->'itemId')<>'string') or (line ? 'currency' and jsonb_typeof(line->'currency')<>'string')
      or (line ? 'itemName' and jsonb_typeof(line->'itemName')<>'string') or (line ? 'name' and jsonb_typeof(line->'name')<>'string')
      or (line ? 'sku' and jsonb_typeof(line->'sku')<>'string') or (line ? 'unit' and jsonb_typeof(line->'unit')<>'string') then
      raise exception 'Historical sale price or description is missing';
    end if;
    qty:=public.sparta_warehouse_number(line->'qty');price:=public.sparta_warehouse_number(line->'salePrice');
    unit_text:=coalesce(line->>'unit','');
    if qty<=0 or qty<>round(qty,3) or price<0 or price<>round(price,2)
      or (unit_text ~* '^(шт[.]?|штук[аи]?|компл[.]?|комплект[и]?|pcs?|set)$' and qty<>trunc(qty)) then
      raise exception 'Historical sale quantity or price is invalid';
    end if;
    line_code:=coalesce(nullif(line->>'currency',''),code);
    if line_code<>code then raise exception 'Historical sale currencies do not match'; end if;
    amount:=round(qty*price,2);total:=total+amount;
    if total>999999999999 then raise exception 'Historical sale amount exceeds supported limits'; end if;
    item_id:=coalesce(nullif(line->>'itemId',''),'history-item:'||position::text);
    name_text:=coalesce(nullif(line->>'itemName',''),nullif(line->>'name',''),'Товар');
    lines:=lines||jsonb_build_array(jsonb_build_object('itemId',item_id,'sku',coalesce(line->>'sku',''),'name',name_text,
      'unit',unit_text,'qty',qty,'unitPrice',price,'currency',code,'lineTotal',amount));
  end loop;
  return result||jsonb_build_object('total',total,'lines',lines,'canLink',true);
exception when others then
  return coalesce(result,'{}'::jsonb)||jsonb_build_object('canLink',false,
    'linkError','Історичний документ не містить коректних дати, кількості або ціни продажу.');
end $$;

create or replace function public.sparta_sales_unlinked_sales(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare state jsonb;
begin
  perform public.sparta_buyer_require_user();
  if not public.has_company_role(p_company_id,array['owner','admin','engineer','warehouse']::public.member_role[]) then
    raise exception 'Sales staff access required' using errcode='42501';
  end if;
  state:=public.sparta_buyer_workspace_state(p_company_id);
  return jsonb_build_object('documents',coalesce((select jsonb_agg(public.sparta_buyer_sale_snapshot(d)
    order by coalesce(d->>'date',d->>'createdAt','') desc,d->>'id') from jsonb_array_elements(coalesce(state->'documents','[]'::jsonb)) d
    where d->>'type'='sale' and d->>'status'='posted'
      and not exists(select 1 from public.buyer_orders o where o.company_id=p_company_id and o.warehouse_document_id=d->>'id')),'[]'::jsonb));
end $$;

create or replace function public.sparta_sales_link_purchase(p_buyer_id uuid,p_document_id text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare account public.buyer_accounts%rowtype; workspace public.warehouse_workspaces%rowtype; previous public.buyer_requests%rowtype;
  existing public.buyer_orders%rowtype; document jsonb; snapshot jsonb; request_hash text; result jsonb; new_order uuid; purchase_time timestamptz;
begin
  perform public.sparta_buyer_require_user();
  if p_request_id is null or p_document_id is null or length(p_document_id) not between 1 and 500 then raise exception 'Missing purchase link identity'; end if;
  select * into account from public.buyer_accounts where id=p_buyer_id;
  if account.id is null or not public.has_company_role(account.company_id,array['owner','admin','warehouse']::public.member_role[]) then
    raise exception 'Purchase history links require owner, admin or warehouse access' using errcode='42501';
  end if;
  -- Same global order as confirmation/fulfilment; account locks never precede
  -- this lock in any flow that also needs warehouse state.
  workspace:=public.sparta_buyer_lock_workspace(account.company_id);
  select * into account from public.buyer_accounts where id=p_buyer_id for no key update;
  request_hash:=md5(jsonb_build_object('buyerId',p_buyer_id,'documentId',p_document_id)::text);
  select * into previous from public.buyer_requests where company_id=account.company_id and user_id=auth.uid() and request_id=p_request_id;
  if previous.request_id is not null then
    if previous.purpose<>'link' or previous.resource_id<>p_buyer_id or previous.payload_hash<>request_hash then
      raise exception 'Request identity was already used for different data' using errcode='22023';
    end if;
    return previous.response;
  end if;
  select value into document from jsonb_array_elements(coalesce(workspace.state->'documents','[]'::jsonb)) where value->>'id'=p_document_id;
  if document is null or document->>'type' is distinct from 'sale' or document->>'status' is distinct from 'posted' then
    raise exception 'A posted company sale document is required' using errcode='42501';
  end if;
  select * into existing from public.buyer_orders where company_id=account.company_id and warehouse_document_id=p_document_id;
  if existing.id is not null then
    if existing.buyer_id<>account.id then raise exception 'Sale is already linked to a different buyer' using errcode='23514'; end if;
    result:=jsonb_build_object('order',public.sparta_buyer_order_json(existing.id));
  else
    snapshot:=public.sparta_buyer_sale_snapshot(document);
    if coalesce((snapshot->>'canLink')::boolean,false) is not true then raise exception 'Historical sale snapshot is incomplete or unsupported' using errcode='23514'; end if;
    purchase_time:=((snapshot->>'date')::date+time '12:00') at time zone 'Europe/Kyiv';
    insert into public.buyer_orders(number,company_id,buyer_id,buyer_name,status,currency,price_type,total,delivery_method,address,phone,comment,
      created_by,created_at,warehouse_document_id,warehouse_document_number)
      values('H-'||upper(substr(md5(account.company_id::text||':'||p_document_id),1,20)),account.company_id,account.id,account.name,'completed',
        snapshot->>'currency',null,(snapshot->>'total')::numeric,'pickup','',account.phone,'Історія покупки за документом '||(snapshot->>'number'),
        auth.uid(),purchase_time,p_document_id,snapshot->>'number') returning id into new_order;
    insert into public.buyer_order_lines(order_id,position,item_id,sku,name,unit,qty,unit_price,currency,line_total)
      select new_order,l.ordinality::integer,l.value->>'itemId',l.value->>'sku',l.value->>'name',l.value->>'unit',
        (l.value->>'qty')::numeric,(l.value->>'unitPrice')::numeric,l.value->>'currency',(l.value->>'lineTotal')::numeric
      from jsonb_array_elements(snapshot->'lines') with ordinality l(value,ordinality);
    result:=jsonb_build_object('order',public.sparta_buyer_order_json(new_order));
    perform public.sparta_audit_record(account.company_id,'purchase_history_link','buyer_orders',new_order::text,snapshot->>'number',null,
      jsonb_build_object('buyerId',account.id,'warehouseDocumentId',p_document_id,'orderId',new_order));
  end if;
  insert into public.buyer_requests(company_id,user_id,request_id,purpose,resource_id,payload_hash,response)
    values(account.company_id,auth.uid(),p_request_id,'link',account.id,request_hash,result);
  -- No inventory change, reservation, warehouse revision, document repost or
  -- cash entry: the physical sale was already posted before this association.
  return result;
end $$;

create or replace function public.sparta_buyer_record_session_event(p_buyer_id uuid,p_event text)
returns void language plpgsql security definer set search_path='' as $$
declare account public.buyer_accounts%rowtype; claims jsonb; session_id text;
begin
  account:=public.sparta_buyer_require_member(p_buyer_id);
  if p_event is null or p_event not in ('login','logout') then raise exception 'Authenticated login or logout event required' using errcode='42501'; end if;
  claims:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;session_id:=claims->>'session_id';
  if coalesce(session_id,'') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'A verified authentication session is required' using errcode='42501'; end if;
  perform public.sparta_audit_record(account.company_id,'buyer_'||p_event,'buyer_session',auth.uid()::text,account.name,null,
    jsonb_build_object('buyerId',account.id),null,md5('buyer:'||session_id||':'||auth.uid()::text||':'||account.id::text));
end $$;

-- Explicit grants + RLS make even raw REST reads own-only. Request identities,
-- invitations and stock holds stay internal; every write passes a checked RPC.
do $$ declare name text; begin
  foreach name in array array['buyer_accounts','buyer_members','buyer_invitations','buyer_orders','buyer_order_lines','buyer_stock_holds','buyer_requests'] loop
    execute format('alter table public.%I enable row level security',name);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',name);
  end loop;
end $$;
grant select on public.buyer_accounts,public.buyer_members,public.buyer_orders,public.buyer_order_lines to authenticated;
drop policy if exists "buyer account own or sales read" on public.buyer_accounts;
create policy "buyer account own or sales read" on public.buyer_accounts for select to authenticated
  using(public.sparta_buyer_is_member(id) or public.has_company_role(company_id,array['owner','admin','engineer','warehouse']::public.member_role[]));
drop policy if exists "buyer member own read" on public.buyer_members;
create policy "buyer member own read" on public.buyer_members for select to authenticated using(user_id=auth.uid() and public.sparta_buyer_is_member(buyer_id));
drop policy if exists "buyer order own or sales read" on public.buyer_orders;
create policy "buyer order own or sales read" on public.buyer_orders for select to authenticated
  using(public.sparta_buyer_is_member(buyer_id) or public.has_company_role(company_id,array['owner','admin','engineer','warehouse']::public.member_role[]));
drop policy if exists "buyer line own or sales read" on public.buyer_order_lines;
create policy "buyer line own or sales read" on public.buyer_order_lines for select to authenticated
  using(exists(select 1 from public.buyer_orders o where o.id=order_id and (public.sparta_buyer_is_member(o.buyer_id)
    or public.has_company_role(o.company_id,array['owner','admin','engineer','warehouse']::public.member_role[]))));

-- Newly created PostgreSQL functions otherwise inherit PUBLIC execution.
do $$ declare fn record; begin
  for fn in select p.oid::regprocedure identity from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and (p.proname like 'sparta_buyer_%' or p.proname like 'sparta_sales_%' or p.proname='sparta_warehouse_staff_read') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',fn.identity);
  end loop;
end $$;
grant execute on function public.sparta_buyer_is_member(uuid),public.sparta_buyer_accept_invitation(),public.sparta_buyer_context(),
  public.sparta_buyer_catalog(uuid),public.sparta_buyer_orders(uuid),public.sparta_buyer_submit_order(uuid,uuid,jsonb,jsonb,numeric),
  public.sparta_buyer_cancel_order(uuid,uuid),public.sparta_sales_buyers(uuid),public.sparta_sales_save_buyer(uuid,jsonb),
  public.sparta_sales_orders(uuid),public.sparta_sales_order_action(uuid,text,uuid),public.sparta_sales_unlinked_sales(uuid),
  public.sparta_sales_link_purchase(uuid,text,uuid),public.sparta_buyer_record_session_event(uuid,text) to authenticated;
revoke all on function public.sparta_warehouse_read(uuid) from public,anon,authenticated,service_role;
grant execute on function public.sparta_warehouse_read(uuid) to authenticated;
grant execute on function public.sparta_buyer_prepare_invitation_email(uuid,uuid),public.sparta_buyer_record_invitation_delivery(uuid,uuid,boolean,text) to service_role;

notify pgrst,'reload schema';
commit;
