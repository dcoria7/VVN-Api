# Cierres de iteración de VVN-API

## 2026-11-27 — Swimlanes de Descubre y coordinación apps/admin

Cierre solicitado para apps, API y web. Consultar [DISCOVER.md](DISCOVER.md) para
el contrato vigente; las apps mantienen sus reglas en
`../../VVN app/docs/PRODUCT_RULES.md` y el admin en
`../../ClickLocalWebApp/docs/descubre-admin.md` desde la raíz de specs.

### Implementado y reglas que se conservan

- `GET /api/v1/descubre` entrega `featured_venues`, `sponsored` y plazas públicas.
  Las dos listas son independientes, con paginación propia y `visible:false`
  cuando no hay items vigentes. La app debe omitir todo el swimlane vacío.
- Los destacados usan el DTO público de venues del directorio, incluidos badges.
  No exponer datos del dueño, bot o facturación. Patrocinados tienen imagen,
  título, tipo y destino propio; no todo patrocinado representa un venue.
- Contenido persistido y administrado, sin selección de respaldo ni campañas
  hardcodeadas. Activación, orden y ventana temporal se validan en el servidor.
- `/track` agrega `featured_impression`, `featured_open`,
  `sponsored_impression` y `sponsored_click`. Selección/campaña deben existir,
  pertenecer a la marca y estar vigentes. Ver claves de atribución en DISCOVER.md.
- GET no registra impresiones; abrir desde destacados no duplica el contador
  normal de vistas. Los consumidores evitarán impresiones por recomposición.
- Conservar operador autenticado y RLS de marca; no introducir service role en
  esta API. La marca viene del despliegue, no de datos del cliente.
- Caché de hasta 60 s sin stale posterior al vencimiento, ETag/304 y errores
  privados no cacheables. Una falla de datos no equivale a una lista vacía.

### Archivos de referencia

- `src/app/api/v1/descubre/route.ts`, `src/services/discover.ts` y sus tests.
- `src/server/stats/discover-tracking.ts`, `track.ts` y la whitelist de eventos.
- `src/lib/brand-client.ts`: las nuevas tablas entran en el contrato por marca.
- `supabase/migrations/20261127041147_discover_swimlanes.sql` y la prueba SQL de
  staging. La raíz canónica de migraciones es la web; su archivo es el mismo SQL.
  No aplicar ambas copias a un mismo entorno.

### Evidencia registrada durante el trabajo

161 pruebas unitarias, tipos y compilación aprobados. Smoke local: 144
comprobaciones de contrato, 43 peticiones de aislamiento y 58 de fallas/recuperación,
todas contra memoria local. Migración y pruebas reales en `vvn-pruebas`: RLS,
referencias, restricciones, métricas, listas ocultas y ETag/304. Los datos sintéticos
se retiraron con rollback; quedaron cero selecciones/campañas de prueba.

### Estado al cerrar

El endpoint y el panel del admin están implementados localmente. La migración
está comprobada en staging. No se aplicó ni se confirmó en este chat la migración
de producción ni se desplegó esta función. iOS/Android todavía deben conectar los
dos swimlanes y sus eventos.

La API general de producción sí está en uso; no confundir ese hecho con la
publicación de esta ampliación. Este cierre solo actualiza documentación y no
certifica cambios concurrentes ajenos a la iteración, aunque estén en el worktree.
