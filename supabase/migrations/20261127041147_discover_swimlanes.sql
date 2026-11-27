-- Descubre: dos listas administradas por marca. No publica contenido inicial.
create table public.vvn_featured_venues (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null default private.current_brand_id() references public.brands(id),
  venue_id uuid not null references public.venues(id) on delete cascade,
  position integer not null default 0 check (position >= 0),
  is_active boolean not null default false,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vvn_featured_window check (ends_at is null or ends_at > starts_at),
  constraint vvn_featured_unique_venue unique (brand_id, venue_id)
);
create table public.vvn_sponsored_campaigns (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null default private.current_brand_id() references public.brands(id),
  title text not null check (char_length(btrim(title)) between 1 and 140),
  image_url text not null check (image_url ~ '^https://[^/[:space:]]+'),
  kind text not null check (kind in ('venue','property_sale','property_rent','survey','other')),
  cta_label text not null default 'Ver más' check (char_length(btrim(cta_label)) between 1 and 40),
  target_type text not null check (target_type in ('venue','url')),
  venue_id uuid references public.venues(id) on delete cascade,
  target_url text,
  fraccionamiento_id uuid references public.fraccionamientos(id) on delete cascade,
  position integer not null default 0 check (position >= 0),
  is_active boolean not null default false,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vvn_sponsored_window check (ends_at is null or ends_at > starts_at),
  constraint vvn_sponsored_target check (
    (target_type = 'venue' and venue_id is not null and target_url is null)
    or (target_type = 'url' and venue_id is null and target_url is not null and target_url ~ '^https://[^/[:space:]]+')
  ),
  constraint vvn_sponsored_venue_kind check (kind <> 'venue' or target_type = 'venue')
);

-- Índices para las lecturas públicas acotadas y las FK que no cubren otros índices.
create index vvn_featured_live_order on public.vvn_featured_venues(brand_id, position, created_at, id) where is_active;
create index vvn_featured_venue_fk on public.vvn_featured_venues(venue_id);
create index vvn_sponsored_live_order on public.vvn_sponsored_campaigns(brand_id, position, created_at, id) where is_active;
create index vvn_sponsored_venue_fk on public.vvn_sponsored_campaigns(venue_id) where venue_id is not null;
create index vvn_sponsored_fracc_fk on public.vvn_sponsored_campaigns(fraccionamiento_id) where fraccionamiento_id is not null;

-- Misma frontera de operador por marca que el resto de VVN. Las relaciones se
-- validan también para escritores privilegiados del admin (service_role).
create function private.enforce_discover_brand() returns trigger
language plpgsql set search_path = '' as $$
declare parent_brand uuid; operator_brand uuid := private.current_brand_id();
begin
  if tg_op = 'UPDATE' and new.brand_id is distinct from old.brand_id then
    raise exception 'Brand is immutable' using errcode = '23514';
  end if;
  if operator_brand is not null and new.brand_id is distinct from operator_brand then
    raise exception 'Cross-brand write' using errcode = '42501';
  end if;
  if new.venue_id is not null then
    select v.brand_id into parent_brand from public.venues v
      where v.id = new.venue_id and v.fraccionamiento_id is not null for key share;
    if parent_brand is null or parent_brand is distinct from new.brand_id then
      raise exception 'Venue unavailable for brand' using errcode = '23514';
    end if;
  end if;
  if tg_table_name = 'vvn_sponsored_campaigns' then
    if new.fraccionamiento_id is not null then
      select f.brand_id into parent_brand from public.fraccionamientos f where f.id = new.fraccionamiento_id for key share;
      if parent_brand is null or parent_brand is distinct from new.brand_id then
        raise exception 'Fraccionamiento unavailable for brand' using errcode = '23514';
      end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function private.enforce_discover_brand() from public, anon;
grant execute on function private.enforce_discover_brand() to authenticated, service_role;
create trigger enforce_discover_brand before insert or update on public.vvn_featured_venues
  for each row execute function private.enforce_discover_brand();
create trigger enforce_discover_brand before insert or update on public.vvn_sponsored_campaigns
  for each row execute function private.enforce_discover_brand();

alter table public.vvn_featured_venues enable row level security;
alter table public.vvn_sponsored_campaigns enable row level security;
revoke all on public.vvn_featured_venues, public.vvn_sponsored_campaigns from public, anon, authenticated;
grant select, insert, update, delete on public.vvn_featured_venues, public.vvn_sponsored_campaigns to authenticated, service_role;
create policy discover_brand_operator on public.vvn_featured_venues for all to authenticated
  using (brand_id = (select private.current_brand_id())) with check (brand_id = (select private.current_brand_id()));
create policy discover_brand_operator on public.vvn_sponsored_campaigns for all to authenticated
  using (brand_id = (select private.current_brand_id())) with check (brand_id = (select private.current_brand_id()));
comment on table public.vvn_featured_venues is 'Selección editorial del admin para Descubre; independiente de patrocinados y del orden del directorio.';
comment on table public.vvn_sponsored_campaigns is 'Campañas del swimlane Patrocinados; gestionadas por el admin, con destino propio y vigencia.';
