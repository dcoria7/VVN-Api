begin;
do $$
declare own_brand uuid; foreign_brand uuid; own_venue uuid; foreign_venue uuid; operator_id uuid;
begin
  select id into strict own_brand from public.brands where slug='vive-valle-norte';
  select o.user_id into strict operator_id from public.brand_operators o where o.brand_id=own_brand limit 1;
  select id into strict own_venue from public.venues where brand_id=own_brand and fraccionamiento_id is not null limit 1;
  select v.id,v.brand_id into strict foreign_venue,foreign_brand from public.venues v join public.brand_operators o on o.brand_id=v.brand_id
    where v.brand_id<>own_brand and v.fraccionamiento_id is not null limit 1;
  perform set_config('vvn_test.brand',own_brand::text,true);
  perform set_config('vvn_test.foreign_brand',foreign_brand::text,true);
  perform set_config('vvn_test.venue',own_venue::text,true);
  perform set_config('vvn_test.foreign_venue',foreign_venue::text,true);
  insert into public.vvn_featured_venues(id,brand_id,venue_id,is_active) values
    ('eeeeeeee-1111-4111-8111-111111111111',own_brand,own_venue,true),
    ('eeeeeeee-2222-4222-8222-222222222222',foreign_brand,foreign_venue,true);
  insert into public.vvn_sponsored_campaigns(id,brand_id,title,image_url,kind,target_type,target_url,is_active) values
    ('eeeeeeee-3333-4333-8333-333333333333',own_brand,'Synthetic campaign','https://example.invalid/photo.jpg','survey','url','https://example.invalid/survey',true),
    ('eeeeeeee-4444-4444-8444-444444444444',foreign_brand,'Other brand','https://example.invalid/photo.jpg','property_rent','url','https://example.invalid/house',true);
  perform set_config('request.jwt.claim.sub',operator_id::text,true);
end $$;
set local role authenticated;
do $$
declare n integer;
begin
  select count(*) into n from public.vvn_featured_venues where id in ('eeeeeeee-1111-4111-8111-111111111111','eeeeeeee-2222-4222-8222-222222222222');
  if n<>1 then raise exception 'Featured RLS failed'; end if;
  select count(*) into n from public.vvn_sponsored_campaigns where id in ('eeeeeeee-3333-4333-8333-333333333333','eeeeeeee-4444-4444-8444-444444444444');
  if n<>1 then raise exception 'Sponsored RLS failed'; end if;
  begin
    insert into public.vvn_sponsored_campaigns(brand_id,title,image_url,kind,target_type,venue_id)
    values (current_setting('vvn_test.brand')::uuid,'Cross brand','https://example.invalid/image.jpg','venue','venue',current_setting('vvn_test.foreign_venue')::uuid);
    raise exception 'Cross-brand venue was allowed';
  exception when check_violation or insufficient_privilege then null; end;
  begin
    insert into public.vvn_sponsored_campaigns(brand_id,title,image_url,kind,target_type,target_url)
    values (current_setting('vvn_test.brand')::uuid,'Missing URL','https://example.invalid/image.jpg','survey','url',null);
    raise exception 'Null URL was allowed';
  exception when check_violation then null; end;
  begin
    update public.vvn_featured_venues set brand_id=current_setting('vvn_test.foreign_brand')::uuid where id='eeeeeeee-1111-4111-8111-111111111111';
    raise exception 'Brand mutation was allowed';
  exception when check_violation or insufficient_privilege then null; end;
  insert into public.analytics_events(event_type,entity_type,entity_id,brand_id,meta) values
    ('featured_open','venue',current_setting('vvn_test.venue')::uuid,current_setting('vvn_test.brand')::uuid,'{"platform":"ios","placement_id":"eeeeeeee-1111-4111-8111-111111111111"}'),
    ('sponsored_click',null,null,current_setting('vvn_test.brand')::uuid,'{"platform":"android","campaign_id":"eeeeeeee-3333-4333-8333-333333333333"}');
end $$;
set local role anon;
do $$ begin
  begin
    perform count(*) from public.vvn_sponsored_campaigns;
    raise exception 'Anonymous table access was allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'RLS, cross-brand references, URL constraints, immutable brand, analytics and anon restrictions passed; fixtures rolled back' as result;
