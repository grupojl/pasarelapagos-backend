// src/config/env.validation.ts
import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV:  z.enum(['development', 'test', 'production']).default('development'),
  PORT:      z.coerce.number().default(3000),

  // ── Base de datos ────────────────────────────────────────────────────────
  DATABASE_URL: z.string().url(),

  // ── Redis ────────────────────────────────────────────────────────────────
  REDIS_URL: z.string().url(),

  // ── CORS ─────────────────────────────────────────────────────────────────
  CORS_ORIGINS: z.string().default(''),

  // ── Rate limiting ────────────────────────────────────────────────────────
  THROTTLE_TTL:              z.coerce.number().default(60),
  THROTTLE_LIMIT:            z.coerce.number().default(200),
  THROTTLE_LIMIT_PER_TENANT: z.coerce.number().optional(),

  // ── Logs ─────────────────────────────────────────────────────────────────
  LOG_LEVEL: z.string().default('info'),

  // ── Webhooks ─────────────────────────────────────────────────────────────
  WEBHOOK_SIGNING_SECRET:          z.string().min(8).default('change-me'),
  WEBHOOK_SIGNING_SECRET_PREVIOUS: z.string().optional(),
  WEBHOOK_TOLERANCE_SECONDS:       z.coerce.number().default(300),

  // ── Reconciliación ───────────────────────────────────────────────────────
  RECONCILE_CRON: z.string().optional(),

  // ── PII ──────────────────────────────────────────────────────────────────
  PII_ENCRYPTION_KEY: z.string().length(64).optional(),
  PII_SEARCH_SALT:    z.string().optional(),

  // ── OpenTelemetry ────────────────────────────────────────────────────────
  OTEL_ENABLED:                z.enum(['true', 'false']).default('false'),
  OTEL_SERVICE_NAME:           z.string().default('pasarela-pagos'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),

  // ── Firebase (mismo proyecto que el owner-dashboard) ─────────────────────
  // Opcionales: si no están, solo funciona el path x-api-key
  FIREBASE_PROJECT_ID:   z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().email().optional(),
  FIREBASE_PRIVATE_KEY:  z.string().optional(),

  // ── Ecosistema SSO ───────────────────────────────────────────────────────
  // URL del owner-dashboard (para consultas de memberships si los claims están vacíos)
  DASHBOARD_API_URL: z.string().url().optional(),

  // ── Providers de pago ────────────────────────────────────────────────────
  STRIPE_SECRET_KEY:          z.string().optional(),
  STRIPE_WEBHOOK_SECRET:      z.string().optional(),
  MERCADOPAGO_ACCESS_TOKEN:   z.string().optional(),
  MERCADOPAGO_WEBHOOK_SECRET: z.string().optional(),
  PAGARME_API_KEY:            z.string().optional(),
  PAGARME_WEBHOOK_SECRET:     z.string().optional(),
  CONEKTA_PRIVATE_KEY:        z.string().optional(),
  CONEKTA_WEBHOOK_SECRET:     z.string().optional(),
  DLOCAL_API_KEY:             z.string().optional(),
  DLOCAL_SECRET_KEY:          z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;
