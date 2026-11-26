# Prompt de arranque — apps nativas Vive Valle Norte

> Copia todo lo que está debajo de la línea y pégalo en una sesión nueva de Claude Code,
> abierta **en la carpeta donde quieras que vivan las apps** (no en el repo de la web).
> El plan completo del que sale este prompt está en
> `~/.claude/plans/en-base-a-todo-lexical-sparkle.md`.

---

# Objetivo

Crea la **base** (andamiaje + una rebanada vertical funcionando) de dos apps móviles nativas
para **Vive Valle Norte** (VVN), un directorio de negocios por plaza comercial para los
fraccionamientos Capital Norte y Valle Imperial, en el norte de Zapopan, Jalisco.

Arquitectura decidida: **núcleo compartido en Kotlin Multiplatform + vistas 100% nativas.**

- Android: **Kotlin + Jetpack Compose + Material 3**
- iOS: **Swift + SwiftUI**, consumiendo el núcleo como XCFramework vía SKIE
- Compartido: modelos, reglas de negocio, red, repositorios, caché, ViewModels

**Nada de Compose Multiplatform. Nada de UI compartida.** Si compartes una pantalla,
rompiste el requisito principal. La lógica se unifica; la navegación, los gestos, los iconos,
la tipografía y los diálogos **divergen** por sistema.

*(Si se decide hacer apps totalmente independientes en vez de KMP, elimina el módulo
`:shared` y porta a Swift las reglas de la sección "Reglas de negocio" — en ese caso los
golden tests de la última sección pasan de recomendados a obligatorios.)*

---

# Antes de empezar, pregúntame

No asumas nada de esto:

1. **Identificadores:** ¿`com.clicklocal.vvn` para los dos, o algo distinto?
2. **Versiones mínimas de sistema:** propón tú un par razonable para 2026 y confírmalo
   conmigo antes de fijarlo en los archivos de build.
3. **Mapa en Android:** ¿tengo API key de Google Maps? Si no, usa **MapLibre con tiles de
   OpenStreetMap**, que es lo que ya usa la web. En iOS usa MapKit (no necesita key).
4. **Repositorio:** ¿un solo repo con los tres módulos, o repos separados? Por default haz
   **un solo repo**.

---

# El repo de la web es la fuente de verdad

La versión web de VVN vive en `/Users/danielcoria/Documents/DCProjects/ClickLocalWebApp`
(Next.js 16 + Supabase). **Léela antes de escribir código.** No la modifiques: es solo
referencia.

Archivos que debes leer, en este orden:

| Archivo | Para qué |
|---|---|
| `CLAUDE.md` (secciones VVN, "Patrones clave", "Calificaciones") | Reglas de producto |
| `specs/SPEC.md` (secciones 4, 6, 8, 11, 17) | Modelo de datos y módulos |
| `src/types/index.ts` | Todos los tipos a portar |
| `src/lib/venue-hours.ts` | **La regla más delicada.** Horarios y estado |
| `src/services/venues.ts` | Mappers `rowToVenue`, orden de queries, la "pared", `isFichaLocked` |
| `src/lib/venue-rating.ts`, `src/lib/venue-category.ts` | Umbral de calificación, catálogo de giros |
| `src/services/promotions.ts` | Vigencia de promociones |
| `src/components/vvn/VvnFraccBrowser.tsx` | Orden, agrupación, búsqueda, paginación |
| `src/components/venue/VenueDetail.tsx` | Las 19 secciones de la ficha y el gate `isPro` |
| `src/lib/daily-update-fresh.ts`, `src/lib/venue-path.ts`, `src/lib/directions-url.ts` | Helpers puros |

---

# Alcance de esta tarea

## Sí construyes

1. **Estructura del proyecto**: `:shared` (KMP), `:androidApp` (Compose), `iosApp` (SwiftUI),
   con el build del XCFramework y SKIE funcionando.
2. **Núcleo compartido**: modelos, mappers, **todas** las reglas de la sección siguiente,
   interfaces de repositorio, y un `FakeVvnDataSource` que sirve fixtures locales.
3. **Rebanada vertical completa en las dos apps**: pantalla **Explorar** (lista de negocios
   del fraccionamiento, agrupados en abiertos/cerrados) → **Ficha de negocio** (con sus
   secciones, el gate `isPro` y el mapa nativo).
4. **Las 4 pestañas** con su navegación; Cupones, Hoy y Más como placeholders honestos
   ("Próximamente") pero ya enrutados.
5. **Tema y tokens** por plataforma a partir de la paleta de abajo.
6. **Tests del núcleo** contra fixtures, incluidos los casos límite de horarios.

## No construyes todavía

Push, caché offline con SQLDelight, cupones guardados, deep links, blog, analytics real,
onboarding. Déjalos como interfaces o TODOs con comentario, no como implementaciones a medias.

## Por qué fixtures y no la API real

La API `/api/v1/*` que consumirán las apps **aún no existe** (es una fase posterior en el
repo web). Para no bloquear la UI: define las interfaces de repositorio con la forma final,
e impleméntalas con un `FakeVvnDataSource` que lea JSON local. Captura esos fixtures de datos
reales con una consulta a Supabase usando la clave pública que está en el `.env.local` del
repo web (solo lectura; la RLS ya permite lectura pública de `venues`, `plazas`, `parques`,
`fraccionamientos`). Cuando la API exista, se cambia la implementación y **nada de la UI se
toca**.

---

# Reglas de negocio a portar al núcleo

Estas son las que fallan en silencio si se portan mal. Pórtalas con cuidado y cúbrelas con
tests.

## 1. Estado abierto/cerrado (`src/lib/venue-hours.ts`)

`opening_hours` es un arreglo de 7 posiciones, cada una `{closed, open: "HH:mm", close: "HH:mm"}`.

Trampas, todas reales:

- **El índice 0 es LUNES**, no domingo. En Kotlin: `dayOfWeek.value - 1`. En Swift,
  `Calendar.component(.weekday)` devuelve 1 = domingo: hay que remapear.
- "Ahora" se calcula **siempre** en `America/Mexico_City`, nunca con el reloj del
  dispositivo ni en UTC.
- El cierre es **exclusivo**: abierto si `open <= ahora < close`.
- `close < open` significa que **cruza medianoche**. No hay bandera; se infiere.
- `close == open` significa **CERRADO**, no 24 horas.
- Hay **spillover** del día anterior: si ayer cruzaba medianoche y ahora es antes de su
  `close`, el negocio está abierto.
- Precedencia del estado: sin `opening_hours` → usar la columna `status` cruda; con horario y
  `status_override` vigente (`status_override_until > ahora`) → usar el override; si no →
  calcular por horario.

En la app, **recalcula el estado cada minuto con un timer** mientras la pantalla está visible.
La web no puede hacerlo (lo congela hasta el próximo render) y es una mejora real y gratis.

## 2. Gate Pro

```
isVvn = venue.fraccionamiento_id != null
isPro = !isVvn || venue.is_premium
```

**Ojo:** la web tiene una incoherencia conocida. `VenueDetail` decide con `isPro`, pero la
política exportada `isFichaLocked` (`services/venues.ts:96`) es
`plaza_id != null && !is_premium`. Divergen para los negocios sueltos del coto (un Oxxo sin
plaza). **Pregúntame cuál es la canónica antes de implementarla.**

Bajo el gate: etiquetas, Instagram, galería, ofertas, actualización del día, catálogo PDF,
menú/servicios y la acción principal (WhatsApp o sitio web). Cuando no es Pro, en su lugar va
el bloque "Esta ficha apenas empieza" con la rejilla de candados.

Fuera del gate, siempre visibles: portada, giro, nombre, estado, descripción, **calificación**,
banner de plaza, horario, ubicación, mapa, "Cómo llegar", banner de reclamo, reportar.

## 3. Orden de la lista (y por qué el `sort` importa)

La fuente ya llega ordenada por: `is_deprioritized` asc, `is_featured` desc, `status` desc,
`name` asc. Encima se aplica **premium primero**, y luego se agrupa en "Abiertos ahora" /
"Cerrados ahora" por el **estado efectivo** (no la columna cruda).

Eso exige un ordenamiento **estable**. `sortedWith` de Kotlin lo es; **`sort` de Swift no**.
Como el orden se calcula en el núcleo, el problema desaparece — pero no lo recalcules en la
capa de UI.

## 4. Resto de reglas

| Regla | Semántica |
|---|---|
| Calificaciones | `avg = sum/count`; **el promedio no se muestra con menos de 3 votos** (`MIN_RATINGS_TO_SHOW`), aunque el conteo sí |
| Vigencia de promoción | `is_active && (starts_at == null \|\| starts_at <= ahora) && (ends_at == null \|\| ends_at > ahora)`. Inicio inclusivo, **fin exclusivo**. Compara instantes, no strings |
| Texto de vigencia | < 24 h → "Termina en N h"; < 48 h → "Termina mañana"; si no → "Vigente hasta el D de mes" (es-MX); vencida → nada |
| Frescura del día | Una actualización del día caduca a las **24 h**; pasado eso se trata como inexistente aunque la columna tenga datos |
| Giros | 13 valores curados en `venue-category.ts`. **El orden del arreglo importa**: define el orden de los chips. `null` = solo aparece bajo "Todos" |
| Teléfono WhatsApp | Siete ramas de casos mexicanos. Pórtala leyendo el original (`VenueDetail.tsx:88`), no de memoria |
| Búsqueda | Subcadena sin distinguir mayúsculas, sobre nombre, plaza, referencia y etiqueta del giro. **No normaliza acentos** — replícalo tal cual |
| Paginación | 10 por grupo (abiertos/cerrados), independientes. En la app es scroll infinito de 10, no un botón |

---

# UI: componentes y flujos nativos

El requisito explícito es que **no se calque la web**. La marca vive en el contenido; los
chromes del sistema se dejan ser nativos.

## iOS (SwiftUI)

| Necesidad | Usa | No hagas |
|---|---|---|
| Navegación | `NavigationStack` con rutas tipadas + `navigationDestination` | Un botón "atrás" propio sobre la portada: rompe el edge-swipe del sistema |
| Pestañas | `TabView` nativo con SF Symbols | Barra propia |
| Búsqueda | `.searchable()` | Un `TextField` con lupa simulando la web |
| Recarga | `.refreshable` | Botón "actualizar" |
| Datos | `.task { for await … }` sobre los `Flow` del núcleo vía SKIE | `onAppear` sin cancelación |
| Hojas | `.sheet` + `.presentationDetents` | Overlays propios |
| Compartir | `ShareLink` | `UIActivityViewController` a mano |
| Cómo llegar | `MKMapItem.openInMaps` directo a Apple Maps; Google Maps en un `Menu` secundario | **No portes el diálogo de la web.** En iOS preguntar primero no es nativo |
| Enlaces y PDF | `SFSafariViewController` | Sacar al usuario de la app |
| Esqueletos | `.redacted(reason: .placeholder)` | Spinners genéricos |
| Haptics | `.sensoryFeedback` al calificar y al copiar cupón | — |
| Tipografía | Estilos semánticos + Dynamic Type | Tamaños fijos en pt |
| Mapa | `Map` de MapKit con un solo `Marker` | — |

Adopta el lenguaje visual vigente del sistema (Liquid Glass en iOS 26+): barras translúcidas,
`.toolbar`. No pintes los hairlines beige de la web sobre los chromes del sistema.

## Android (Compose / Material 3)

| Necesidad | Usa | No hagas |
|---|---|---|
| Navegación | Navigation Compose con rutas tipadas | — |
| Regreso | Back del sistema + **predictive back** (`enableOnBackInvokedCallback`) | Un botón propio como único camino |
| Pestañas | `NavigationBar` de Material 3 | — |
| Pantalla | **Edge-to-edge** (`enableEdgeToEdge()`) + `WindowInsets` | Paddings fijos para la barra de estado |
| Búsqueda | `SearchBar` de Material 3 | — |
| Filtros | `FilterChip` en `LazyRow` | — |
| Listas | `LazyVerticalGrid` / `LazyColumn` con `key =` **estable** | `Column` con scroll; el índice como key |
| Hojas | `ModalBottomSheet` | Diálogos para todo |
| Recarga | `PullToRefreshBox` | — |
| Imágenes | Coil 3, con `placeholder` y `crossfade` | Cargar el original sin presupuesto |
| Compartir | `ShareCompat` / `ACTION_SEND` | — |
| Cómo llegar | `ACTION_VIEW` con `geo:` y **que el sistema ofrezca el selector** | Un diálogo propio (aquí sí el selector es nativo — al revés que iOS) |
| Enlaces y PDF | Custom Tabs | — |
| Color | Acentos de marca fijos; Material You solo en superficies | Que el fondo del usuario se coma la identidad |

## Reglas táctiles (no negociables)

- Objetivos de toque ≥ **44 pt** en iOS, **48 dp** en Android — incluidas las 5 estrellas de
  calificación y los chips de giro.
- Acciones primarias en la **zona del pulgar** (tercio inferior); las irreversibles, lejos.
- Nada **solo por gesto**: todo gesto tiene su botón equivalente.
- Todo estado de carga explícito; todo error con mensaje y reintento. Cero pantallas muertas.
- Listas siempre virtualizadas.
- Etiquetas de accesibilidad en los iconos sin texto.

## Marca

Fondo `#f5f2ee` · verde `#1a7a1a` (oscuro `#145c14`, claro `#d1f0d1`) · charcoal `#2d3130` ·
hairlines `#ede9e4` y `#d0cbc5` · verde WhatsApp `#25D366`.

Logo: tres renglones centrados, "Vive" en charcoal / "Valle Norte" en verde / "by ClickLocal"
en gris pequeño (ver `src/components/vvn/VvnLogo.tsx`).

Tipografía: **la del sistema** (SF Pro / Roboto). La web usa Geist; no la traigas.

## Las 4 pestañas

```
Explorar  ·  Cupones  ·  Hoy  ·  Más
```

El menú lateral de la web (`VvnMenu`) **no se porta**: es una convención web. El selector de
fraccionamiento (hoy un segmented control que navega) se vuelve **preferencia persistente**,
cambiable desde la barra de navegación.

---

# Terminado cuando

1. `./gradlew :shared:allTests` pasa, con tests que cubren: cruce de medianoche, spillover del
   día anterior, `close == open`, override vigente y vencido, venue sin horario, el umbral de 3
   calificaciones, vigencia de promoción en los tres bordes, y los 7 formatos de teléfono.
2. `./gradlew :androidApp:assembleDebug` compila y la app corre en el emulador: se ve la lista
   de negocios agrupada en abiertos/cerrados, se busca, se filtra por giro, se abre una ficha,
   y la ficha muestra el mapa y respeta el gate `isPro`.
3. El proyecto de iOS compila y corre en el simulador con la **misma** rebanada vertical,
   consumiendo el mismo núcleo.
4. Las otras tres pestañas navegan a un placeholder, no a una pantalla en blanco.
5. Hay un `README.md` en la raíz con: cómo construir cada app, cómo regenerar el XCFramework,
   dónde viven los fixtures y qué falta (push, offline, cupones, deep links).

## Cómo verificar

- **Android:** compila y usa el emulador. Prueba también con Dynamic Type / tamaño de fuente
  grande y en modo oscuro.
- **iOS:** usa la herramienta de simulador de esta sesión (`attach` antes de construir,
  después `launch`, `screenshot` y `tap`). Prueba Dynamic Type al tamaño máximo sin que se
  rompa ninguna tarjeta.
- **Paridad:** levanta la web del repo de referencia (`npm run dev`, puerto 3000, con
  `NEXT_PUBLIC_VVN_LOCAL=1`) y compara lado a lado tres fichas reales: estado abierto/cerrado,
  secciones capadas y promedio de calificación deben coincidir.

## Golden tests contra la web (hazlo en esta tarea, no después)

En el repo de la web, escribe `scripts/export-rule-fixtures.ts`: un script que ejecute las
implementaciones TS y emita `fixtures/rules.json` con pares entrada→salida de
`getEffectiveStatus`, `isOpenByHours`, `isPromotionLive`, `formatPromoValidity`,
`buildVenueRating`, `normalizeWhatsAppPhone`, `slugifyName` e `isDailyUpdateFresh`. Copia ese
JSON al proyecto móvil y haz que los tests del núcleo afirmen paridad contra él.

Es lo único que evita que una regla cambie en la web y se quede vieja en las apps. Es la
pieza de más valor de toda la tarea: no la dejes para el final.

---

# Cómo trabajar

- **No inventes versiones de librerías.** Averigua las vigentes al montar el proyecto y
  fíjalas explícitamente. Aplica igual a Kotlin, Gradle, AGP, Compose, SKIE, Ktor y Coil.
- Lee la documentación de lo que no hayas verificado en esta sesión antes de usarlo. Esto
  aplica especialmente a SKIE y a la configuración del XCFramework.
- No modifiques el repo de la web, salvo el script de fixtures que se pide arriba.
- Si una decisión de producto no está en este prompt ni en el repo de referencia,
  **pregúntame** en vez de elegir por mí.
- Avísame al terminar cada una de estas tres etapas, no solo al final: (1) núcleo compilando
  con tests verdes, (2) Android corriendo, (3) iOS corriendo.
