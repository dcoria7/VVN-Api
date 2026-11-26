import "server-only";
import { deploymentScope } from "./deployment-brand";
import { headers } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

export type RateLimitRouteKey =
  | "stats"
  | "webhook"
  | "admin-write"
  | "admin-toggle"
  | "admin-login"
  | "lead-submit"
  | "rating-submit"
  | "device-register"
  | "api-read";

type RateLimitPolicy = {
  limit: number;
  windowMs: number;
};

type BucketState = {
  count: number;
  resetAt: number;
};

type Store = Map<string, BucketState>;

const RATE_LIMITS: Record<RateLimitRouteKey, RateLimitPolicy> = {
  stats: { limit: 30, windowMs: 60_000 },
  webhook: { limit: 120, windowMs: 60_000 },
  "admin-write": { limit: 20, windowMs: 60_000 },
  "admin-toggle": { limit: 40, windowMs: 60_000 },
  // Login: freno anti fuerza bruta de la contraseña de admin.
  "admin-login": { limit: 10, windowMs: 60_000 },
  // Formularios públicos de leads (/unirse): freno anti spam.
  "lead-submit": { limit: 5, windowMs: 60_000 },
  // Calificaciones de venue: un visitante legítimo vota una o dos veces por sesión.
  "rating-submit": { limit: 5, windowMs: 60_000 },
  // Registro del token de push de las apps: generoso a propósito. La app lo llama
  // al arrancar y cada vez que FCM/APNs rota el token, y varios dispositivos
  // detrás de un mismo NAT comparten IP.
  "device-register": { limit: 30, windowMs: 60_000 },
  // Lecturas públicas que amplifican (hoy solo /api/v1/venues/resolve, que escanea
  // la tabla de venues por cada path inédito). Holgado: un deep link por tap, y
  // varios usuarios pueden compartir IP detrás de un NAT.
  "api-read": { limit: 60, windowMs: 60_000 },
};

function getStore(): Store {
  const g = globalThis as { __clicklocalRateLimitStore?: Store };
  if (!g.__clicklocalRateLimitStore) g.__clicklocalRateLimitStore = new Map();
  return g.__clicklocalRateLimitStore;
}

function trimStore(store: Store, now: number): void {
  if (store.size < 5000) return;
  for (const [k, v] of store.entries()) {
    if (v.resetAt <= now) store.delete(k);
  }
}

function toHeaderValues(limit: number, remaining: number, resetAt: number): Record<string, string> {
  const retrySeconds = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  return {
    "X-RateLimit-Limit": String(limit),
    "X-RateLimit-Remaining": String(Math.max(0, remaining)),
    "X-RateLimit-Reset": String(Math.ceil(resetAt / 1000)),
    "Retry-After": String(retrySeconds),
  };
}

export function getRequestClientIp(req: NextRequest | Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const xrip = req.headers.get("x-real-ip")?.trim();
  if (xrip) return xrip;
  return "unknown";
}

export async function getActionClientKey(): Promise<string> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const xrip = h.get("x-real-ip")?.trim();
  if (xrip) return xrip;
  const ua = h.get("user-agent")?.trim();
  return ua ? `ua:${ua}` : "unknown";
}

type RateLimitResult = { ok: boolean; headers: Record<string, string> };

// ── Backend distribuido (Upstash Redis / Vercel Marketplace) ───────────────
// El limitador en memoria no sirve en serverless: cada instancia tiene su
// propio contador y son efímeras. Si hay Redis configurado, se usa un contador
// compartido y atómico (INCR + PEXPIRE = ventana fija). Si no, cae al de
// memoria (útil en dev o despliegues sin Redis).

let redisClient: Redis | null = null;
let redisResolved = false;

function getRedis(): Redis | null {
  if (redisResolved) return redisClient;
  redisResolved = true;
  // Acepta las variables del cliente Upstash o las que puebla la integración de
  // Vercel. La integración de Upstash-for-Redis en Vercel puede prefijar los
  // nombres estándar (p. ej. UPSTASH_REDIS_REST_KV_REST_API_URL): los aceptamos
  // como respaldo para no depender de renombrar variables gestionadas por la
  // integración. El cliente REST necesita el endpoint https + su token.
  const url =
    process.env.UPSTASH_REDIS_REST_URL ??
    process.env.KV_REST_API_URL ??
    process.env.UPSTASH_REDIS_REST_KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ??
    process.env.KV_REST_API_TOKEN ??
    process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN;
  if (url && token) {
    redisClient = new Redis({ url, token });
  }
  return redisClient;
}

async function consumeViaRedis(
  redis: Redis,
  route: RateLimitRouteKey,
  clientKey: string,
  policy: RateLimitPolicy
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowStart = Math.floor(now / policy.windowMs) * policy.windowMs;
  const resetAt = windowStart + policy.windowMs;
  const key = `rl:${deploymentScope}:${route}:${clientKey}:${windowStart}`;

  const count = await redis.incr(key);
  if (count === 1) {
    // Fija el TTL de la ventana solo en el primer golpe.
    await redis.pexpire(key, policy.windowMs);
  }

  const remaining = policy.limit - count;
  return {
    ok: count <= policy.limit,
    headers: toHeaderValues(policy.limit, remaining, resetAt),
  };
}

function consumeInMemory(
  route: RateLimitRouteKey,
  clientKey: string,
  policy: RateLimitPolicy
): RateLimitResult {
  const now = Date.now();
  const store = getStore();
  trimStore(store, now);

  const bucketKey = `${deploymentScope}:${route}:${clientKey}`;
  const current = store.get(bucketKey);

  if (!current || current.resetAt <= now) {
    const next: BucketState = { count: 1, resetAt: now + policy.windowMs };
    store.set(bucketKey, next);
    return {
      ok: true,
      headers: toHeaderValues(policy.limit, policy.limit - 1, next.resetAt),
    };
  }

  if (current.count >= policy.limit) {
    return {
      ok: false,
      headers: toHeaderValues(policy.limit, 0, current.resetAt),
    };
  }

  current.count += 1;
  store.set(bucketKey, current);
  return {
    ok: true,
    headers: toHeaderValues(policy.limit, policy.limit - current.count, current.resetAt),
  };
}

export async function consumeRateLimit(
  route: RateLimitRouteKey,
  clientKey: string
): Promise<RateLimitResult> {
  const policy = RATE_LIMITS[route];
  const redis = getRedis();
  if (redis) {
    try {
      return await consumeViaRedis(redis, route, clientKey, policy);
    } catch (e) {
      // Ante un fallo de Redis no bloqueamos el servicio: caemos a memoria.
      console.error("[rate-limit] Redis falló, usando memoria:", e instanceof Error ? e.message : e);
    }
  }
  return consumeInMemory(route, clientKey, policy);
}

export function applyRateLimitHeaders(res: NextResponse, headerMap: Record<string, string>): NextResponse {
  for (const [k, v] of Object.entries(headerMap)) {
    res.headers.set(k, v);
  }
  return res;
}

