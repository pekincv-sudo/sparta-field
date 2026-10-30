-- Build47: explicit sales payments and owner/admin sales gross-profit report.
-- Apply after buyer-portal.sql (and the existing cash/team migrations).
-- No payments, stock movements, users or historical costs are invented.
begin;
do $$ begin
  if to_regclass('public.cash_transactions') is null
    or to_regclass('public.buyer_orders') is null
    or to_regprocedure('public.sparta_buyer_change_order(uuid,text,uuid,boolean)') is null
    or to_regprocedure('public.sparta_audit_snapshot(text,jsonb)') is null then
    raise exception 'Apply cash-transactions.sql, team-build36.sql and buyer-portal.sql before sales-cash-build47.sql';
  end if;
end $$;

-- NULL retains legacy classification by project_client_id without rewriting
-- the immutable journal. Every new entry gets an explicit source in its guard.
alter table public.cash_transactions add column if not exists source_type text
  check(source_type in ('project','sale','general'));
alter table public.cash_transactions add column if not exists sale_order_id uuid references public.buyer_orders(id);
alter table public.cash_transactions add column if not exists sale_order_number text not null default '';
alter table public.cash_transactions add column if not exists buyer_id uuid references public.buyer_accounts(id);
alter table public.cash_transactions add column if not exists buyer_name text not null default '';
alter table public.cash_transactions drop constraint if exists cash_transactions_category_check;
alter table public.cash_transactions add constraint cash_transactions_category_check check(category in (
  'client_payment','client_refund','labor','materials','other_income','other_expense','opening_balance','sale_payment','sale_refund'));
create index if not exists cash_transactions_company_sale_idx
  on public.cash_transactions(company_id,sale_order_id,occurred_at desc,id);

create or replace function public.validate_cash_transaction()
returns trigger language plpgsql security invoker set search_path='' as $$
declare original public.cash_transactions%rowtype; duplicate public.cash_transactions%rowtype; sale public.buyer_orders%rowtype;
  original_source text; paid numeric; payment_delta numeric;
begin
  if auth.uid() is null or not public.has_company_role(new.company_id,array['owner','admin']::public.member_role[]) then
    raise exception 'Only an active company owner or admin can post cash entries.' using errcode='42501';
  end if;
  if new.currency is null or new.currency not in ('USD','UAH') then raise exception 'Select cash currency: USD or UAH'; end if;
  new.created_by:=auth.uid(); new.created_at:=statement_timestamp();
  new.counterparty:=btrim(new.counterparty); new.purpose:=btrim(new.purpose);
  new.project_title:=btrim(coalesce(new.project_title,''));
  new.project_client_id:=nullif(btrim(new.project_client_id),'');
  new.source_type:=coalesce(nullif(btrim(new.source_type),''),case when new.sale_order_id is not null then 'sale'
    when new.project_client_id is not null then 'project' else 'general' end);
  new.sale_order_number:=btrim(coalesce(new.sale_order_number,''));
  new.buyer_name:=btrim(coalesce(new.buyer_name,''));
  if new.source_type not in ('project','sale','general') then raise exception 'Invalid cash source'; end if;

  -- Payments, refunds and reversals share an advisory transaction lock. The
  -- browser has SELECT (not UPDATE) on buyer orders; this leaves those grants
  -- intact and serializes refunds without taking a warehouse workspace lock.
  if new.source_type='sale' then
    if new.sale_order_id is null or new.project_client_id is not null or new.project_title<>'' then
      raise exception 'Sales cash must reference one order and no project';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.company_id::text||':'||new.sale_order_id::text,47));
  elsif new.sale_order_id is not null or new.sale_order_number<>'' or new.buyer_id is not null or new.buyer_name<>'' then
    raise exception 'Only sales cash may contain buyer/order references';
  end if;

  -- A lost-response retry acknowledges the original canonical snapshot even
  -- if an order was cancelled or a project removed after the first commit.
  -- Audit attribution/time are server owned and not business request fields.
  select * into duplicate from public.cash_transactions c where c.id=new.id and c.company_id=new.company_id;
  if duplicate.id is not null then
    if new.source_type='sale' then
      new.sale_order_number:=duplicate.sale_order_number; new.buyer_id:=duplicate.buyer_id; new.buyer_name:=duplicate.buyer_name;
    end if;
    if ((to_jsonb(new)-array['created_at','created_by','source_type'])||jsonb_build_object('source_type',new.source_type)) is distinct from
      ((to_jsonb(duplicate)-array['created_at','created_by','source_type'])||jsonb_build_object('source_type',coalesce(duplicate.source_type,
        case when duplicate.project_client_id is null then 'general' else 'project' end))) then
      raise exception 'Cash request identity was already used for different data' using errcode='22023';
    end if;
    return new;
  end if;
  if new.source_type='sale' then
    select * into sale from public.buyer_orders where id=new.sale_order_id and company_id=new.company_id;
    if sale.id is null then raise exception 'The selected sale does not belong to this company' using errcode='42501'; end if;
    if new.currency<>sale.currency then raise exception 'Cash currency must match sale currency'; end if;
  end if;

  if new.reverses_id is not null then
    select * into original from public.cash_transactions where id=new.reverses_id;
    if not found then raise exception 'Original cash entry was not found or is not accessible.'; end if;
    if original.reverses_id is not null then raise exception 'A reversal cannot itself be reversed.'; end if;
    original_source:=coalesce(original.source_type,case when original.project_client_id is null then 'general' else 'project' end);
    if new.company_id is distinct from original.company_id or new.source_type is distinct from original_source
      or new.project_client_id is distinct from original.project_client_id or new.project_title is distinct from original.project_title
      or new.sale_order_id is distinct from original.sale_order_id or new.sale_order_number is distinct from original.sale_order_number
      or new.buyer_id is distinct from original.buyer_id or new.buyer_name is distinct from original.buyer_name
      or new.category is distinct from original.category or new.currency is distinct from original.currency
      or new.amount_minor is distinct from original.amount_minor or new.payment_method is distinct from original.payment_method
      or new.direction is distinct from (case original.direction when 'income' then 'expense' else 'income' end) then
      raise exception 'A reversal must preserve company, source, project, sale, buyer, category, amount and payment method, with the opposite direction.';
    end if;
  else
    if (new.category in ('client_payment','other_income','opening_balance','sale_payment') and new.direction<>'income')
      or (new.category in ('client_refund','labor','materials','other_expense','sale_refund') and new.direction<>'expense') then
      raise exception 'Cash category does not match its direction.';
    end if;
    if new.source_type='project' then
      if new.project_client_id is null then raise exception 'Project cash must reference a project'; end if;
      if exists(select 1 from public.projects p where p.company_id=new.company_id and p.client_id=new.project_client_id and p.currency<>new.currency) then
        raise exception 'Cash currency must match project currency; currencies are accounted separately';
      end if;
      if not exists(select 1 from public.projects p where p.company_id=new.company_id and p.client_id=new.project_client_id) then
        raise exception 'The selected project does not belong to this company or has not been synchronized.';
      end if;
    elsif new.source_type='general' and (new.project_client_id is not null or new.project_title<>'') then
      raise exception 'General cash cannot contain a project';
    end if;
    if new.source_type='sale' then
      if new.category not in ('sale_payment','sale_refund','other_income','other_expense') then raise exception 'Invalid sales cash category'; end if;
      if new.category<>'sale_refund' and sale.status not in ('confirmed','ready','completed') then
        raise exception 'Sales payments require a confirmed, ready or completed order';
      end if;
      new.sale_order_number:=sale.number; new.buyer_id:=sale.buyer_id; new.buyer_name:=sale.buyer_name;
    elsif new.category in ('sale_payment','sale_refund') then
      raise exception 'Sale payment/refund requires a sales order';
    end if;
  end if;
  -- Let the existing unique reversal constraint reach the browser's confirmed
  -- reversal resolver instead of failing a second time on the net-paid check.
  if new.reverses_id is not null and exists(select 1 from public.cash_transactions c where c.reverses_id=new.reverses_id and c.company_id=new.company_id) then
    return new;
  end if;
  if new.source_type='sale' and new.category in ('sale_payment','sale_refund') then
    select coalesce(sum(case c.direction when 'income' then c.amount_minor else -c.amount_minor end),0)
      into paid from public.cash_transactions c where c.company_id=new.company_id and c.sale_order_id=new.sale_order_id
      and c.currency=new.currency and c.category in ('sale_payment','sale_refund');
    payment_delta:=case new.direction when 'income' then new.amount_minor else -new.amount_minor end;
    if paid+payment_delta<0 then raise exception 'Sale refund exceeds recorded payments; reverse refunds before reversing a payment'; end if;
  end if;
  return new;
end $$;
revoke all on function public.validate_cash_transaction() from public,anon;
grant execute on function public.validate_cash_transaction() to authenticated;

-- This helper reads only posted document snapshots. It never looks up current
-- catalog prices or costs. Legacy zero costs without a known flag stay unknown.
create or replace function public.sparta_sales_cost_snapshot(p_document jsonb,p_currency text,p_total numeric)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare base jsonb; line jsonb; cost numeric:=0; unit_cost numeric; qty numeric; reason text;
begin
  if p_document is null then reason:='Не знайдено проведену накладну продажу.';
  else
    base:=public.sparta_buyer_sale_snapshot(p_document);
    if not coalesce((base->>'canLink')::boolean,false) or base->>'currency' is distinct from p_currency
      or (base->>'total')::numeric is distinct from p_total then
      reason:='Валюта або сума накладної не відповідає замовленню.';
    else
      for line in select value from jsonb_array_elements(p_document->'lines') loop
        if jsonb_typeof(line->'unitCost') not in ('number','string') or coalesce(line->>'unitCost','') !~ '^[0-9]+([.][0-9]+)?$' then
          reason:='У накладній не збережено собівартість усіх товарів.'; exit;
        end if;
        unit_cost:=(line->>'unitCost')::numeric; qty:=(line->>'qty')::numeric;
        if (line ? 'unitCostKnown' and line->'unitCostKnown' is distinct from 'true'::jsonb)
          or (not(line ? 'unitCostKnown') and unit_cost=0) then
          reason:='У накладній є товар з невідомою закупівельною собівартістю.'; exit;
        end if;
        cost:=cost+round(qty*unit_cost,2);
      end loop;
      if cost*100>9007199254740991 then reason:='Собівартість перевищує допустиму точність звіту.'; end if;
    end if;
  end if;
  return jsonb_build_object('costKnown',reason is null,'costMinor',case when reason is null then (cost*100)::bigint end,
    'grossProfitMinor',case when reason is null then ((p_total-cost)*100)::bigint end,'costUnknownReason',coalesce(reason,''));
end $$;
revoke all on function public.sparta_sales_cost_snapshot(jsonb,text,numeric) from public,anon,authenticated,service_role;

create or replace function public.sparta_sales_finance(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare sale public.buyer_orders%rowtype; docs jsonb; document jsonb; margin jsonb; paid numeric; order_total numeric;
  rows jsonb:='[]'::jsonb; row_data jsonb; summaries jsonb:='[]'::jsonb; code text; revenue numeric; cost numeric;
  profit numeric; known_cost numeric; known_profit numeric; unknown_count integer; completed_count integer;
  paid_total numeric; outstanding_total numeric; credit_total numeric; refund_total numeric;
begin
  perform public.sparta_buyer_require_user();
  if not public.has_company_role(p_company_id,array['owner','admin']::public.member_role[]) then
    raise exception 'Sales finance requires an active owner or admin' using errcode='42501';
  end if;
  -- No fallback to today's catalog. Completed portal/link orders have a saved
  -- warehouse workspace document, otherwise the report explicitly lacks cost.
  select coalesce(state->'documents','[]'::jsonb) into docs from public.warehouse_workspaces where company_id=p_company_id;
  docs:=coalesce(docs,'[]'::jsonb);
  for sale in select * from public.buyer_orders where company_id=p_company_id order by created_at desc,id loop
    select coalesce(sum(case c.direction when 'income' then c.amount_minor else -c.amount_minor end),0)
      into paid from public.cash_transactions c where c.company_id=p_company_id and c.sale_order_id=sale.id
      and c.currency=sale.currency and c.category in ('sale_payment','sale_refund');
    order_total:=sale.total*100; document:=null;
    margin:=jsonb_build_object('costKnown',false,'costMinor',null,'grossProfitMinor',null,'costUnknownReason','Товар ще не видано зі складу.');
    if sale.status='completed' then
      select d into document from jsonb_array_elements(docs) d where d->>'id'=sale.warehouse_document_id limit 1;
      margin:=public.sparta_sales_cost_snapshot(document,sale.currency,sale.total);
    end if;
    if abs(paid)>9007199254740991 or abs(order_total-paid)>9007199254740991 then raise exception 'Finance totals exceed supported precision'; end if;
    row_data:=jsonb_build_object('orderId',sale.id,'orderNumber',sale.number,'buyerId',sale.buyer_id,'buyerName',sale.buyer_name,
      'status',sale.status,'currency',sale.currency,'orderTotalMinor',order_total::bigint,'paidMinor',paid::bigint,
      'outstandingMinor',case when sale.status in ('confirmed','ready','completed') then greatest(order_total-paid,0)::bigint else 0 end,
      'creditMinor',case when sale.status='cancelled' then 0 else greatest(paid-order_total,0)::bigint end,
      'refundDueMinor',case when sale.status='cancelled' then greatest(paid,0)::bigint else 0 end,
      'documentId',sale.warehouse_document_id,'documentNumber',coalesce(document->>'number',sale.warehouse_document_number,sale.number),
      'issuedAt',case when sale.status='completed' then coalesce(document->>'createdAt',document->>'recordedAt',document->>'date',sale.updated_at::text) end,
      'revenueMinor',case when sale.status='completed' then order_total::bigint else 0 end)||margin;
    rows:=rows||jsonb_build_array(row_data);
  end loop;
  foreach code in array array['USD','UAH'] loop
    select count(*) filter(where x->>'status'='completed'),
      count(*) filter(where x->>'status'='completed' and x->>'costKnown'='false'),
      coalesce(sum((x->>'revenueMinor')::numeric),0),
      coalesce(sum((x->>'costMinor')::numeric) filter(where x->>'status'='completed' and x->>'costKnown'='true'),0),
      coalesce(sum((x->>'grossProfitMinor')::numeric) filter(where x->>'status'='completed' and x->>'costKnown'='true'),0),
      coalesce(sum((x->>'paidMinor')::numeric),0),coalesce(sum((x->>'outstandingMinor')::numeric),0),
      coalesce(sum((x->>'creditMinor')::numeric),0),coalesce(sum((x->>'refundDueMinor')::numeric),0)
      into completed_count,unknown_count,revenue,known_cost,known_profit,paid_total,outstanding_total,credit_total,refund_total
      from jsonb_array_elements(rows) x where x->>'currency'=code;
    if greatest(abs(revenue),abs(known_cost),abs(known_profit),abs(paid_total),abs(outstanding_total),abs(credit_total),abs(refund_total))>9007199254740991 then
      raise exception 'Finance totals exceed supported precision';
    end if;
    summaries:=summaries||jsonb_build_array(jsonb_build_object('currency',code,'completedCount',completed_count,
      'revenueMinor',revenue::bigint,'costMinor',case when unknown_count=0 then known_cost::bigint end,
      'grossProfitMinor',case when unknown_count=0 then known_profit::bigint end,'knownCostMinor',known_cost::bigint,
      'knownGrossProfitMinor',known_profit::bigint,'unknownCostCount',unknown_count,'paidMinor',paid_total::bigint,
      'outstandingMinor',outstanding_total::bigint,'creditMinor',credit_total::bigint,'refundDueMinor',refund_total::bigint));
  end loop;
  return jsonb_build_object('orders',rows,'totals',summaries);
end $$;
revoke all on function public.sparta_sales_finance(uuid) from public,anon,service_role;
grant execute on function public.sparta_sales_finance(uuid) to authenticated;

-- The fulfilment function below is the existing atomic operation with only
-- unitCostKnown added to its private issue snapshot. No existing sale is edited.

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

-- Add the new immutable linkage fields to the existing owner/admin audit trail.
create or replace function public.sparta_audit_snapshot(p_table text,p_row jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb; keys text[];
begin
  if p_row is null then return null; end if;
  keys:=case p_table
    when 'projects' then array['client_id','title','client_name','client_phone','address','object_type','status','installation_date','team_name','comment','currency']
    when 'project_technical' then array['panel_manufacturer','panel_model','panel_power_w','panel_count','panel_serial_numbers','inverter_manufacturer','inverter_model','inverter_power_kw','inverter_serial_number','mppt_count','pv_inputs_per_mppt','battery_manufacturer','battery_model','battery_capacity_kwh','battery_modules_count','battery_serial_numbers']
    when 'project_strings' then array['mppt_number','pv_input_number','string_number','string_type','panel_count','orientation','tilt_angle','note']
    when 'project_materials' then array['category','name','quantity','unit']
    when 'project_photos' then array['category','caption','file_name','storage_path','equipment_type','equipment_id']
    when 'project_files' then array['category','note','file_name','mime_type','file_size','storage_path']
    when 'project_tasks' then array['client_task_id','project_client_id','title','note','task_type','status','priority','due_at','assigned_to']
    when 'warehouse_items' then array['client_item_id','category','name','sku','unit','quantity','purchase_price','sale_price','min_quantity','location']
    when 'material_catalog' then array['category','name','default_unit','is_active']
    when 'company_members' then array['user_id','role','is_active']
    when 'company_invitations' then array['email','full_name','role','invited_by','accepted_at','accepted_by','expires_at','revoked_at','created_at']
    when 'cash_transactions' then array['source_type','sale_order_id','sale_order_number','buyer_id','buyer_name','project_client_id','project_title','direction','category','currency','amount_minor','counterparty','purpose','occurred_at','payment_method','reverses_id']
    when 'profiles' then array['full_name','email','phone']
    when 'companies' then array['name','phone','email','address']
    else array[]::text[] end;
  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into result from jsonb_each(p_row) where key=any(keys) and jsonb_typeof(value) not in ('object','array');
  if p_table='projects' then
    result:=result||jsonb_build_object('finance',coalesce((select jsonb_object_agg(key,value) from jsonb_each(coalesce(p_row->'finance','{}'::jsonb)) where key in ('contractPrice','installationPrice','advancePaid','crewPayroll','contractNumber','contractDate') and jsonb_typeof(value) not in ('array','object')),'{}'::jsonb),
      'financeDetailsFingerprint',md5(coalesce(p_row->'finance','{}'::jsonb)::text),
      'work_checklist',coalesce(p_row->'work_checklist','{}'::jsonb));
  elsif p_table='project_technical' then
    result:=result||jsonb_build_object('equipmentFingerprint',md5(coalesce(p_row->'equipment_details','{}'::jsonb)::text));
  elsif p_table in ('project_materials','warehouse_items') then
    result:=result||coalesce((select jsonb_object_agg(key,value) from jsonb_each(coalesce(p_row->'app_data','{}'::jsonb)) where key in ('currency','warehouseItemId','plannedQty','issuedQty','actualQty','purchasePriceSnapshot','salePriceSnapshot','brand','model','deliveryCost','extraCost','installerPrice','retailPrice','supplier') and jsonb_typeof(value) not in ('array','object')),'{}'::jsonb);
  elsif p_table in ('project_files','project_photos') then
    result:=result||coalesce((select jsonb_object_agg(key,value) from jsonb_each(coalesce(p_row->'app_data','{}'::jsonb)) where key in ('stage','crmTaskId','cashEntryId') and jsonb_typeof(value) not in ('array','object')),'{}'::jsonb);
  elsif p_table='warehouse_workspaces' then
    result:=jsonb_build_object('items',jsonb_array_length(coalesce(p_row->'state'->'items','[]'::jsonb)),
      'documents',jsonb_array_length(coalesce(p_row->'state'->'documents','[]'::jsonb)),
      'movements',jsonb_array_length(coalesce(p_row->'state'->'movements','[]'::jsonb)),
      'reservations',jsonb_array_length(coalesce(p_row->'state'->'reservations','[]'::jsonb)),
      'stateFingerprint',md5(coalesce(p_row->'state','{}'::jsonb)::text));
  end if;
  return result;
end $$;

commit;
