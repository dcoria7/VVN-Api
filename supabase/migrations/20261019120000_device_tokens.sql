-- Tokens de notificaciones push de las apps nativas de Vive Valle Norte.
--
-- Migración ADITIVA: tabla nueva, no toca nada existente.
--
-- Un token es un IDENTIFICADOR DE DISPOSITIVO. No se registra en logs ni en
-- Sentry, y el público nunca lo lee: RLS activo sin ninguna política, igual que
-- analytics_events y venue_ratings, así que toda la E/S pasa por
-- /api/v1/devices con la service role.
--
-- `visitor_key` es el mismo hash con salt que usan las calificaciones (ver
-- src/lib/visitor-id.ts): sirve para correlacionar dispositivo y visitante sin
-- guardar ningún identificador en claro. Es opcional porque la app puede
-- registrar el token antes de que el visitante haga nada.
--
-- El ENVÍO de las notificaciones es trabajo de admin y queda fuera de esta tabla.

create table public.device_tokens (
  id                   uuid primary key default uuid_generate_v4(),
  -- Token de FCM/APNs. Único, pero NO es la identidad del dispositivo: el sistema
  -- lo rota, así que deduplicar por token dejaría la fila vieja suscrita y el
  -- teléfono recibiría la notificación dos veces. Esa identidad es `install_id`.
  token                text not null unique,
  -- Identificador ESTABLE de la instalación (UUID que genera la app y conserva
  -- mientras esté instalada). Es la clave de upsert cuando la app lo manda.
  -- Nullable porque un cliente viejo podría no mandarlo; el unique parcial deja
  -- convivir las filas sin él.
  install_id           uuid,
  platform             text not null check (platform in ('ios', 'android')),
  -- Coto que el usuario eligió en el onboarding: filtro de envío por zona.
  -- Texto y no FK para que un slug renombrado no borre registros de dispositivo.
  fraccionamiento_slug text,
  -- Temas suscritos (p. ej. 'ofertas', 'blog', 'actualizaciones').
  topics               text[] not null default '{}',
  app_version          text,
  visitor_key          text,

  created_at           timestamptz not null default now(),
  -- La app lo refresca al arrancar: permite purgar dispositivos muertos.
  last_seen_at         timestamptz not null default now()
);

-- Una fila por instalación. Parcial porque `install_id` es nullable.
create unique index device_tokens_install_idx
  on public.device_tokens (install_id)
  where install_id is not null;

-- La consulta real del envío: "los dispositivos de esta zona vistos hace poco".
-- Compuesto y no dos índices separados, para que no haga falta un bitmap-and.
create index device_tokens_fracc_seen_idx
  on public.device_tokens (fraccionamiento_slug, last_seen_at desc);

-- `topics` es el mecanismo de suscripción, así que el envío filtra por
-- `topics @> '{ofertas}'`. Sin GIN eso es un seq scan. Crearlo ahora es una línea;
-- después es una migración sobre una tabla caliente.
create index device_tokens_topics_idx on public.device_tokens using gin (topics);

-- Los dispositivos de un visitante (para soporte y para borrado a petición).
create index device_tokens_visitor_idx on public.device_tokens (visitor_key)
  where visitor_key is not null;

alter table public.device_tokens enable row level security;

revoke insert, update, delete on public.device_tokens from anon, authenticated;
revoke select on public.device_tokens from anon, authenticated;

comment on table public.device_tokens is 'Tokens de push de las apps nativas de Vive Valle Norte. Identificadores de dispositivo: escritura y lectura solo por service role vía /api/v1/devices. Nunca se loguean.';
comment on column public.device_tokens.install_id is 'Identidad estable de la instalación, invariante a la rotación del token de push. Clave de deduplicación: sin ella, cada rotación dejaría un registro fantasma suscrito.';
comment on column public.device_tokens.last_seen_at is 'Última vez que la app registró este token (se actualiza en cada arranque). Base para purgar dispositivos inactivos.';

-- PENDIENTE a propósito (no bloquea el alta de la tabla): no hay endpoint de baja
-- (`DELETE /api/v1/devices`), así que la app no puede desuscribirse al revocar el
-- permiso, y no hay dónde marcar un token que FCM reporta como `NotRegistered`.
-- Cuando se construya el envío, agregar `invalid_at timestamptz` y la ruta de baja.
