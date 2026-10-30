-- Public product specifications for the buyer catalog. Apply after buyer-portal.sql.
-- Read-only contract extension: no prices, stock, orders or access memberships change.
-- Deliberately allowlist technical fields. Never expose the whole warehouse item.
begin;
do $$ begin
  if to_regprocedure('public.sparta_buyer_catalog(uuid)') is null then
    raise exception 'Apply database/buyer-portal.sql before the product-detail upgrade';
  end if;
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
revoke all on function public.sparta_buyer_catalog(uuid) from public,anon;
grant execute on function public.sparta_buyer_catalog(uuid) to authenticated;
commit;
