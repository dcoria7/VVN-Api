import { getFraccionamientos } from "@/services/fraccionamientos";
import { getVvnSiteUrl } from "@/lib/site-url";
import { reportError } from "@/lib/report-error";
import { deploymentEnvironment } from "@/lib/deployment-environment";
import {
  CONTACT_EMAIL,
  PLAN_FREE_FEATURES,
  PLAN_PRO_FEATURES,
  PLAN_PRO_LIST_PRICE_MXN,
  PLAN_PRO_PRICE_MXN,
  PLAN_PRO_PRICE_NOTE,
  PLAN_PRO_TAGLINE,
} from "@/lib/plan-pro";
import { API_VERSION, CACHE_READ_SHORT, CACHE_PRIVATE, apiOk, apiServerError } from "@/server/api/respond";

/**
 * GET /api/v1/config
 *
 * Todo lo que debe poder cambiar SIN publicar una versión de la app: versión
 * mínima soportada, interruptor de apagado, fraccionamiento por default, datos de
 * contacto y precios del Plan Pro.
 *
 * Caché corta (60 s) justamente porque es la palanca de emergencia: si hay que
 * apagar las apps, no se puede esperar 5 minutos.
 */
export async function GET(req: Request) {
  try {
    // Mismo criterio que el home del dominio VVN (src/app/vvn/page.tsx): el
    // primero por nombre. Si la lectura falla, la app cae a su default compilado.
    let defaultSlug: string | null = null;
    let degraded = false;
    try {
      defaultSlug = (await getFraccionamientos())[0]?.slug ?? null;
    } catch (error) {
      // El interruptor de mantenimiento debe seguir disponible con la DB caída.
      // Señalar y reportar la degradación; no cachear el default incompleto.
      degraded = true;
      reportError(error, { route: "v1/config", fallback: "default_fraccionamiento_slug" });
    }

    const killEnabled = process.env.MOBILE_KILL_SWITCH === "1";

    return apiOk(
      req,
      {
        api_version: API_VERSION,
        environment: deploymentEnvironment,
        min_app_version: {
          ios: process.env.MOBILE_MIN_VERSION_IOS?.trim() || "1.0.0",
          android: process.env.MOBILE_MIN_VERSION_ANDROID?.trim() || "1.0.0",
        },
        kill_switch: {
          enabled: killEnabled,
          message: killEnabled
            ? process.env.MOBILE_KILL_MESSAGE?.trim() ||
              "Estamos en mantenimiento. Vuelve en un rato."
            : null,
        },
        default_fraccionamiento_slug: defaultSlug,
        contact: {
          whatsapp: process.env.NEXT_PUBLIC_ADMIN_WHATSAPP?.trim() || null,
          email: CONTACT_EMAIL,
        },
        plan_pro: {
          price_mxn: PLAN_PRO_PRICE_MXN,
          list_price_mxn: PLAN_PRO_LIST_PRICE_MXN,
          price_note: PLAN_PRO_PRICE_NOTE,
          tagline: PLAN_PRO_TAGLINE,
          features: PLAN_PRO_FEATURES,
        },
        plan_free: {
          features: PLAN_FREE_FEATURES("Vive Valle Norte"),
        },
        web: { site_url: getVvnSiteUrl() },
      },
      degraded ? CACHE_PRIVATE : CACHE_READ_SHORT,
      degraded ? { "X-Data-Degraded": "1" } : {},
    );
  } catch (e) {
    return apiServerError("v1/config", e);
  }
}
