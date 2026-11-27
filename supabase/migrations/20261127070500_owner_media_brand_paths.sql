-- Preserve owner retries, audit history, daily merge and local-midnight overrides.
-- Follow-up for environments that already applied owner_access.
-- Keep the brand UUID first, compatible with brand_storage_boundary.
-- Existing bucket settings are preserved; fresh staging needs the two buckets.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values
 ('venue-media','venue-media',true,8388608,array['image/jpeg','image/png','image/webp']),
 ('venue-catalogs','venue-catalogs',true,83886080,array['application/pdf'])
on conflict (id) do nothing;

drop policy if exists owner_media_insert on storage.objects;
drop policy if exists owner_media_select on storage.objects;
drop policy if exists owner_media_delete on storage.objects;
drop policy if exists owner_media_write on storage.objects;
create policy owner_media_write on storage.objects for all to authenticated
using (
 bucket_id in ('venue-media','venue-catalogs')
 and (storage.foldername(storage.objects.name))[1]=(select private.current_brand_id())::text
 and (storage.foldername(storage.objects.name))[2]='owners'
 and exists(select 1 from public.venues v where v.id::text=(storage.foldername(storage.objects.name))[3]
  and v.brand_id=(select private.current_brand_id()))
)
with check (
 bucket_id in ('venue-media','venue-catalogs')
 and (storage.foldername(storage.objects.name))[1]=(select private.current_brand_id())::text
 and (storage.foldername(storage.objects.name))[2]='owners'
 and exists(select 1 from public.venues v where v.id::text=(storage.foldername(storage.objects.name))[3]
  and v.brand_id=(select private.current_brand_id()))
);

create or replace function public.vvn_owner_api(p_brand uuid,p_op text,p_args jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
 a private.vvn_owner_access; v public.venues; vid uuid; k text; cols text[]; tbl text; sets text;
 vals jsonb; item uuid; result jsonb; before_data jsonb;
begin
 if auth.role()<>'service_role' and (auth.uid() is null or private.current_brand_id() is distinct from p_brand) then
  return jsonb_build_object('error','unauthorized');
 end if;
 if p_op in ('admin_status','admin_invite','admin_revoke','admin_cancel') then vid := (p_args->>'venue_id')::uuid;
 elsif p_op in ('preview','claim') then
  select venue_id into vid from private.vvn_owner_access where invitation_hash=p_args->>'invitation_hash' and brand_id=p_brand;
 else
  select venue_id into vid from private.vvn_owner_access where session_hash=p_args->>'session_hash' and device_hash=p_args->>'device_hash' and brand_id=p_brand;
 end if;
 -- Parent row first: one consistent lock for invite, claim, write and revocation.
 select * into v from public.venues where id=vid and brand_id=p_brand for update;
 if not found then return jsonb_build_object('error','unauthorized'); end if;
 insert into private.vvn_owner_access(venue_id,brand_id) values(vid,p_brand) on conflict do nothing;
 select * into a from private.vvn_owner_access where venue_id=vid for update;
 if not v.is_premium or (v.paid_until is not null and (v.paid_until at time zone 'UTC')::date < (now() at time zone 'America/Mexico_City')::date) then
  update private.vvn_owner_access set session_hash=null,device_hash=null,invitation_hash=null,invitation_expires_at=null,revoked_at=now() where venue_id=vid;
  if p_op<>'admin_status' then return jsonb_build_object('error','pro_required'); end if;
  a.session_hash:=null; a.invitation_hash:=null;
 end if;
 if p_op='admin_status' then
  return jsonb_build_object('linked',a.session_hash is not null,'linked_at',a.linked_at,'invitation_pending',a.invitation_hash is not null and a.invitation_expires_at>now(),'expires_at',a.invitation_expires_at,'revoked_at',a.revoked_at,'history',coalesce((select jsonb_agg(row) from (select operation,changes,created_at from private.vvn_owner_audit where venue_id=vid and brand_id=p_brand order by created_at desc,id desc limit 20) row),'[]'::jsonb));
 elsif p_op='admin_revoke' or p_op='admin_cancel' then
  update private.vvn_owner_access set invitation_hash=null,invitation_expires_at=null,
   session_hash=case when p_op='admin_revoke' then null else session_hash end,
   device_hash=case when p_op='admin_revoke' then null else device_hash end,
   revoked_at=case when p_op='admin_revoke' then now() else revoked_at end where venue_id=vid;
 elsif p_op='admin_invite' then
  if a.session_hash is not null then return jsonb_build_object('error','already_linked'); end if;
  update private.vvn_owner_access set invitation_hash=p_args->>'invitation_hash',invitation_expires_at=now()+interval '24 hours',linked_at=null where venue_id=vid;
  return jsonb_build_object('expires_at',now()+interval '24 hours');
 elsif p_op in ('preview','claim') then
  -- Identical claim retry is safe after a lost response; no second device can win.
  if p_op='claim' and a.session_hash=p_args->>'session_hash' and a.device_hash=p_args->>'device_hash' then
   return jsonb_build_object('venue_id',vid,'name',v.name);
  end if;
  if a.session_hash is not null or a.invitation_expires_at<=now() then return jsonb_build_object('error','invitation_unavailable'); end if;
  if p_op='preview' then return jsonb_build_object('venue_id',vid,'name',v.name,'cover_url',v.cover_url,'expires_at',a.invitation_expires_at); end if;
  if exists(select 1 from private.vvn_owner_access where device_hash=p_args->>'device_hash' and venue_id<>vid) then return jsonb_build_object('error','device_linked'); end if;
  update private.vvn_owner_access set session_hash=p_args->>'session_hash',device_hash=p_args->>'device_hash',linked_at=now(),revoked_at=null where venue_id=vid;
 elsif p_op='read' then
  cols:=array['id','name','type','category','description','tags','phone','instagram','contact_cta','website_url','rappi_url','didi_url','uber_eats_url','address','lat','lng','location_reference','local_number','floor','location_note','is_ambulatory','is_closed_door','opening_hours','status','logo_url','cover_url','catalog_pdf_url','catalog_updated_on','daily_text','daily_image_url','daily_updated_at'];
  select jsonb_object_agg(key,value) into result from jsonb_each(to_jsonb(v)) where key=any(cols);
  return jsonb_build_object('venue',result,'revision',v.owner_revision,
   'menu',coalesce((select jsonb_agg(to_jsonb(m)-array['brand_id','venue_id','created_at'] order by m."order",m.id) from public.menu_items m where venue_id=vid and brand_id=p_brand),'[]'::jsonb),
   'services',coalesce((select jsonb_agg(to_jsonb(s)-array['brand_id','venue_id','created_at'] order by s."order",s.id) from public.services s where venue_id=vid and brand_id=p_brand),'[]'::jsonb),
   'photos',coalesce((select jsonb_agg(to_jsonb(f)-array['brand_id','venue_id','created_at'] order by f."order",f.id) from public.venue_photos f where venue_id=vid and brand_id=p_brand),'[]'::jsonb),
   'promotions',coalesce((select jsonb_agg(to_jsonb(p)-array['brand_id','venue_id','created_at','updated_at','views','taps'] order by p.created_at desc,p.id) from public.promotions p where venue_id=vid and brand_id=p_brand),'[]'::jsonb));
 elsif p_op='authorize' then return jsonb_build_object('venue_id',vid);
 elsif p_op='save' then
  if exists(select 1 from private.vvn_owner_receipts where venue_id=vid and session_hash=p_args->>'session_hash' and request_hash=p_args->>'request_hash') then return jsonb_build_object('saved',true); end if;
  if (p_args->>'revision')::bigint is distinct from v.owner_revision then return jsonb_build_object('error','conflict'); end if;
  tbl:=p_args->>'section'; vals:=p_args->'values'; item:=(p_args->>'item_id')::uuid;
  if tbl='info' then cols:=array['name','type','category','description','tags'];
  elsif tbl='contact' then cols:=array['phone','instagram','contact_cta','website_url','rappi_url','didi_url','uber_eats_url'];
  elsif tbl='location' then cols:=array['address','lat','lng','location_reference','local_number','floor','location_note','is_ambulatory','is_closed_door'];
  elsif tbl='hours' then cols:=array['opening_hours','status'];
  elsif tbl='branding' then cols:=array['logo_url','cover_url'];
  elsif tbl='catalog' then cols:=array['catalog_pdf_url','catalog_updated_on'];
  elsif tbl='daily' then cols:=array['daily_text','daily_image_url'];
  elsif tbl='menu' then cols:=array['name','description','price','image_url','category','is_available','order'];
  elsif tbl='services' then cols:=array['name','description','price','duration','image_url','is_available','order'];
  elsif tbl='photos' then cols:=array['url','order'];
  elsif tbl='promotions' then cols:=array['kind','title','description','discount_label','code','image_url','terms','starts_at','ends_at','is_active'];
  else return jsonb_build_object('error','invalid'); end if;
  if jsonb_typeof(vals)<>'object' or vals='{}'::jsonb and coalesce(p_args->>'delete','false')<>'true' then return jsonb_build_object('error','invalid'); end if;
  for k in select jsonb_object_keys(vals) loop
   if not k=any(cols) then return jsonb_build_object('error','invalid'); end if;
  end loop;
  if tbl in ('menu','services','photos','promotions') then
   tbl:=case tbl when 'menu' then 'menu_items' when 'photos' then 'venue_photos' else tbl end;
   if item is not null then
    execute format('select to_jsonb(t) from public.%I t where id=$1 and venue_id=$2 and brand_id=$3 for update',tbl) into before_data using item,vid,p_brand;
    if before_data is null then return jsonb_build_object('error','not_found'); end if;
   end if;
   if p_args->>'delete'='true' then
    if item is null then return jsonb_build_object('error','invalid'); end if;
    execute format('delete from public.%I where id=$1 and venue_id=$2 and brand_id=$3',tbl) using item,vid,p_brand;
   elsif item is not null then
    select string_agg(format('%I=(jsonb_populate_record(null::public.%I,$1)).%I',key,tbl,key),',') into sets from jsonb_object_keys(vals) key;
    execute format('update public.%I set %s where id=$2 and venue_id=$3 and brand_id=$4',tbl,sets) using vals,item,vid,p_brand;
   else
    if tbl='venue_photos' and (select count(*) from public.venue_photos where venue_id=vid)>=10 then return jsonb_build_object('error','photo_limit'); end if;
    select string_agg(format('%I',key),','),string_agg(format('(jsonb_populate_record(null::public.%I,$1)).%I',tbl,key),',') into k,sets from jsonb_object_keys(vals) key;
    execute format('insert into public.%I (venue_id,brand_id,%s) select $2,$3,%s',tbl,k,sets) using vals,vid,p_brand;
   end if;
  else
   before_data:=to_jsonb(v);
   if tbl='daily' then vals:=vals||jsonb_build_object('daily_updated_at',case when coalesce((to_jsonb(v)||vals)->>'daily_text','')='' and coalesce((to_jsonb(v)||vals)->>'daily_image_url','')='' then null else now() end); end if;
   if tbl='hours' and vals ? 'status' then vals:=vals||jsonb_build_object('status_override',vals->>'status','status_override_until',((date_trunc('day',now() at time zone 'America/Mexico_City')+interval '1 day') at time zone 'America/Mexico_City')); end if;
   select string_agg(format('%I=(jsonb_populate_record(null::public.venues,$1)).%I',key,key),',') into sets from jsonb_object_keys(vals) key;
   execute format('update public.venues set %s,updated_at=now() where id=$2 and brand_id=$3',sets) using vals,vid,p_brand;
  end if;
  insert into private.vvn_owner_audit(venue_id,brand_id,operation,changes) values(vid,p_brand,'save:'||(p_args->>'section'),jsonb_build_object('item_id',item,'delete',p_args->'delete','before',case when before_data is null then null else (select jsonb_object_agg(key,value) from jsonb_each(before_data) where key=any(cols)) end,'after',vals));
  insert into private.vvn_owner_receipts(venue_id,brand_id,session_hash,request_hash) values(vid,p_brand,p_args->>'session_hash',p_args->>'request_hash');
  return jsonb_build_object('saved',true);
 else return jsonb_build_object('error','invalid');
 end if;
 insert into private.vvn_owner_audit(venue_id,brand_id,operation) values(vid,p_brand,p_op);
 return jsonb_build_object('venue_id',vid,'name',v.name);
end $$;
