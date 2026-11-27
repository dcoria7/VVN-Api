# VVN-API: contexto y reglas permanentes

Leer README.md y las specs relevantes antes de cambiar contratos. API independiente
para iOS/Android, construida con Next.js. Consultar las skills de Next.js y, para
base de datos, Supabase y Postgres. Usar la documentación local de Next cuando se
cambien convenciones de rutas.

## Cierre de iteración: “travesura terminada”

Cuando el usuario diga **travesura terminada**, actualizar los MD con las reglas
nuevas, decisiones confirmadas, flujos importantes, contratos, validaciones y
pendientes relevantes. La mención de la frase para explicar esta regla no activa
un cierre. Reconciliar reglas superadas y distinguir implementación local,
staging y producción. No guardar secretos ni datos de prueba como contenido real.

La memoria de iOS/Android vive en `../VVN app/docs/PRODUCT_RULES.md`. Mantener las
specs de esta API como fuente de sus contratos; no afirmar que el admin o las apps
están conectados solo porque existe un endpoint. Consultar
[specs/ITERATIONS.md](specs/ITERATIONS.md) para el último cierre y coordinar las
reglas con el admin web cuando la iteración abarque las tres aplicaciones.

## Datos y seguridad

- Base final de producción: `https://api.vivevallenorte.com/api/v1`.
- Las apps consumen esta API; no Supabase directamente.
- La marca del despliegue viene del entorno del servidor, nunca de la petición.
- `createSupabaseAdmin` es un nombre heredado: usa operador autenticado limitado
  por marca y RLS. No introducir un fallback a service role.
- Usar los DTO públicos existentes. No exponer teléfonos del bot, owner_id,
  credenciales o información interna de facturación.
- Conservar envoltura `{ok,data}`, errores genéricos, ETag/304 y política de caché.
  Un fallo de lectura no debe convertirse en una lista vacía cacheable.
- Verificar cambios SQL primero en `vvn-pruebas`; no ejecutar pruebas con datos
  sintéticos contra producción. No desplegar producción por una orden de cierre.

## Reglas de Descubre

Ver `specs/DISCOVER.md`. Destacados y patrocinados son listas independientes,
curadas desde el admin, con orden, activación y vigencia persistidos. Los
patrocinados pueden ser negocios, inmuebles o encuestas. No hardcodear contenido.

Si un swimlane no tiene contenido público vigente, devolver `visible:false` y
`items:[]`; el consumidor omite la sección completa, sin título ni placeholder.
Leer un listado no genera impresiones. Las aperturas atribuidas no reemplazan ni
duplican el contador normal de vistas de negocio.
