-- Owner credentials never reach public venue DTOs. Operator-only RPC, invoker + RLS.
create table private.vvn_owner_access (
 venue_id uuid primary key references public.venues(id) on delete cascade,
 brand_id uuid not null references public.brands(id),
 invitation_hash text unique, invitation_expires_at timestamptz,
 session_hash text unique, device_hash text unique,
 linked_at timestamptz, revoked_at timestamptz,
 constraint owner_hashes check ((invitation_hash is null or invitation_hash ~ '^[a-f0-9]{64}$') and (session_hash is null or session_hash ~ '^[a-f0-9]{64}$') and (device_hash is null or device_hash ~ '^[a-f0-9]{64}$'))
);
create index vvn_owner_access_brand on private.vvn_owner_access(brand_id);
create table private.vvn_owner_audit (
 id bigint generated always as identity primary key,
 venue_id uuid not null references public.venues(id) on delete cascade,
 brand_id uuid not null references public.brands(id),
 operation text not null, changes jsonb not null default '{}', created_at timestamptz not null default now()
);
create index vvn_owner_audit_venue on private.vvn_owner_audit(brand_id,venue_id,created_at desc);
alter table private.vvn_owner_access enable row level security;
alter table private.vvn_owner_audit enable row level security;
revoke all on private.vvn_owner_access, private.vvn_owner_audit from public,anon,authenticated;
grant select,insert,update,delete on private.vvn_owner_access to authenticated,service_role;
grant select,insert on private.vvn_owner_audit to authenticated,service_role;
grant usage on sequence private.vvn_owner_audit_id_seq to authenticated,service_role;
create policy owner_brand on private.vvn_owner_access to authenticated using (brand_id=(select private.current_brand_id())) with check (brand_id=(select private.current_brand_id()));
create policy owner_audit_brand on private.vvn_owner_audit to authenticated using (brand_id=(select private.current_brand_id())) with check (brand_id=(select private.current_brand_id()));
alter table public.venues add column owner_revision bigint not null default 0;

create function private.vvn_owner_revision() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_table_name='venues' then
  -- Analytics counters do not cause editing conflicts. Admin/bot content does.
  if (to_jsonb(new)-array['views','whatsapp_taps','website_taps','rating_sum','rating_count','updated_at','owner_revision']) is distinct from
     (to_jsonb(old)-array['views','whatsapp_taps','website_taps','rating_sum','rating_count','updated_at','owner_revision']) then
   new.owner_revision := old.owner_revision+1;
  end if;
  if (old.is_premium and not new.is_premium) or
     (old.paid_until is not null and (old.paid_until at time zone 'America/Mexico_City')::date < (now() at time zone 'America/Mexico_City')::date) then
    update private.vvn_owner_access set session_hash=null,device_hash=null,invitation_hash=null,invitation_expires_at=null,revoked_at=now() where venue_id=new.id;
  end if;
  return new;
 end if;
 update public.venues set owner_revision=owner_revision+1 where id=case when tg_op='DELETE' then old.venue_id else new.venue_id end;
 return null;
end $$;
revoke all on function private.vvn_owner_revision() from public,anon;
grant execute on function private.vvn_owner_revision() to authenticated,service_role;
create trigger owner_revision before update on public.venues for each row execute function private.vvn_owner_revision();
create trigger owner_revision after insert or update or delete on public.menu_items for each row execute function private.vvn_owner_revision();
create trigger owner_revision after insert or update or delete on public.services for each row execute function private.vvn_owner_revision();
create trigger owner_revision after insert or update or delete on public.promotions for each row execute function private.vvn_owner_revision();
create trigger owner_revision after insert or update or delete on public.venue_photos for each row execute function private.vvn_owner_revision();

-- The public gateway is SECURITY INVOKER, never exposes a definer to anonymous users.
create function public.vvn_owner_api(p_brand uuid,p_op text,p_args jsonb) returns jsonb
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
 if not v.is_premium or (v.paid_until is not null and (v.paid_until at time zone 'America/Mexico_City')::date < (now() at time zone 'America/Mexico_City')::date) then
  update private.vvn_owner_access set session_hash=null,device_hash=null,invitation_hash=null,invitation_expires_at=null,revoked_at=now() where venue_id=vid;
  if p_op<>'admin_status' then return jsonb_build_object('error','pro_required'); end if;
  a.session_hash:=null; a.invitation_hash:=null;
 end if;
 if p_op='admin_status' then
  return jsonb_build_object('linked',a.session_hash is not null,'linked_at',a.linked_at,'invitation_pending',a.invitation_hash is not null and a.invitation_expires_at>now(),'expires_at',a.invitation_expires_at,'revoked_at',a.revoked_at);
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
   if tbl='daily' then vals:=vals||jsonb_build_object('daily_updated_at',case when coalesce(vals->>'daily_text','')='' and coalesce(vals->>'daily_image_url','')='' then null else now() end); end if;
   if tbl='hours' and vals ? 'status' then vals:=vals||jsonb_build_object('status_override',vals->>'status','status_override_until',now()+interval '12 hours'); end if;
   select string_agg(format('%I=(jsonb_populate_record(null::public.venues,$1)).%I',key,key),',') into sets from jsonb_object_keys(vals) key;
   execute format('update public.venues set %s,updated_at=now() where id=$2 and brand_id=$3',sets) using vals,vid,p_brand;
  end if;
  insert into private.vvn_owner_audit(venue_id,brand_id,operation,changes) values(vid,p_brand,'save:'||(p_args->>'section'),jsonb_build_object('item_id',item,'delete',p_args->'delete','before',case when before_data is null then null else (select jsonb_object_agg(key,value) from jsonb_each(before_data) where key=any(cols)) end,'after',vals));
  return jsonb_build_object('saved',true);
 else return jsonb_build_object('error','invalid');
 end if;
 insert into private.vvn_owner_audit(venue_id,brand_id,operation) values(vid,p_brand,p_op);
 return jsonb_build_object('venue_id',vid,'name',v.name);
end $$;
revoke all on function public.vvn_owner_api(uuid,text,jsonb) from public,anon;
grant execute on function public.vvn_owner_api(uuid,text,jsonb) to authenticated,service_role;

-- Dedicated namespace; operator cannot overwrite legacy admin files.
create policy owner_media_insert on storage.objects for insert to authenticated with check (
 bucket_id='venue-media' and (storage.foldername(name))[1]='owners' and (storage.foldername(name))[2]=(select private.current_brand_id())::text
 and exists(select 1 from public.venues v where v.id::text=(storage.foldername(name))[3] and v.brand_id=(select private.current_brand_id()))
);
