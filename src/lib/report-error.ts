import * as Sentry from "@sentry/nextjs";

// Punto ÚNICO para reportar errores no controlados de la app. Lo llaman
// error.tsx / global-error.tsx (y cualquier catch que quiera reportar a mano).
// Loguea en los Function Logs de Vercel y envía el error a Sentry.
export function reportError(error: unknown, context?: Record<string, unknown>): void {
  console.error("[reportError]", error, context ?? {});
  Sentry.captureException(error, context ? { extra: context } : undefined);
}
