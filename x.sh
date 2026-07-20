#!/usr/bin/env bash
# =============================================================================
# setup-pagos-mp-sandbox.sh
#
# Bootstrap completo de pasarela-pagos para pruebas de integración con
# MercadoPago sandbox. Cubre:
#
#   1. Validación del entorno (variables, servicios)
#   2. Generación del .env.development con credenciales sandbox MP
#   3. Seed de Tenant + TenantApiKey con organizationId del ecosistema
#   4. ProviderRoutes AR/ARS → mercadopago (priority 100) para sandbox
#   5. Curl smoke-test: health + create payment + list + retrieve
#   6. Instrucciones para webhook con ngrok
#
# PREREQUISITOS:
#   - PostgreSQL corriendo (DATABASE_URL configurada o pasada por env)
#   - Redis corriendo (REDIS_URL configurada o pasada por env)
#   - pnpm instalado
#   - Node.js >= 20
#   - Credenciales MercadoPago sandbox (ver sección CREDENCIALES abajo)
#
# CÓMO OBTENER CREDENCIALES SANDBOX MP:
#   1. mercadopago.com/developers/panel
#   2. Tu aplicación → Credenciales → Modo prueba
#   3. Copiá: Access Token (TEST-xxx) + Public Key (TEST-xxx)
#   4. Para webhooks sandbox: Webhooks → Agregar URL (ngrok) → Seleccionar "payment"
#
# USO:
#   MP_ACCESS_TOKEN="TEST-xxxxx" \
#   MP_PUBLIC_KEY="TEST-xxxxx" \
#   MP_WEBHOOK_SECRET="tu-secret-webhook" \
#   ORG_ID="el-organization-id-del-owner-dashboard" \
#   bash setup-pagos-mp-sandbox.sh
#
# Si no pasás ORG_ID, el script usa un UUID estable de dev:
#   org_dev_00000000-0000-0000-0000-000000000001
# =============================================================================

set -euo pipefail

# ─── Colores ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
log()     { echo -e "${CYAN}▶${NC} $1"; }
ok()      { echo -e "${GREEN}✓${NC} $1"; }
warn()    { echo -e "${YELLOW}⚠${NC}  $1"; }
fail()    { echo -e "${RED}✗${NC} $1"; exit 1; }
section() { echo -e "\n${BOLD}${CYAN}══ $1 ══${NC}"; }

# ─── Guardia: correr desde la raíz del proyecto pasarela-pagos ────────────────
if [ ! -f "package.json" ] || ! grep -q '"name".*"pasarela-pagos"' package.json 2>/dev/null; then
  fail "Corré este script desde la raíz de pasarela-pagos (donde está package.json con name=pasarela-pagos)"
fi

# ─── Variables de entorno con defaults ────────────────────────────────────────
MP_ACCESS_TOKEN="${MP_ACCESS_TOKEN:-}"
MP_PUBLIC_KEY="${MP_PUBLIC_KEY:-}"
MP_WEBHOOK_SECRET="${MP_WEBHOOK_SECRET:-mp-webhook-secret-dev}"
ORG_ID="${ORG_ID:-org_dev_00000000-0000-0000-0000-000000000001}"
DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/pasarela_pagos_dev}"
REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
PORT="${PORT:-3003}"
DEV_API_KEY="pk_test-api-key-dev-only"

# ─── Validaciones ─────────────────────────────────────────────────────────────
section "Validando entorno"

if [ -z "$MP_ACCESS_TOKEN" ]; then
  warn "MP_ACCESS_TOKEN no seteada."
  warn "Las ProviderRoutes de MercadoPago estarán en la DB pero el provider"
  warn "no se inicializará en runtime hasta que configures la variable."
  warn "Podés igual hacer pruebas: el FakeProvider tiene prioridad 1 (fallback)."
  MP_ACCESS_TOKEN="TEST-placeholder-set-real-token-before-running"
fi

if [ -z "$MP_PUBLIC_KEY" ]; then
  MP_PUBLIC_KEY="TEST-placeholder-set-real-public-key"
fi

# Verificar node
if ! command -v node &>/dev/null; then
  fail "Node.js no encontrado. Instalá Node.js >= 20"
fi
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  fail "Node.js >= 20 requerido. Versión actual: $(node --version)"
fi
ok "Node.js $(node --version)"

# Verificar pnpm
if ! command -v pnpm &>/dev/null; then
  fail "pnpm no encontrado. Instalá con: npm i -g pnpm"
fi
ok "pnpm $(pnpm --version)"

# Verificar PostgreSQL
if command -v pg_isready &>/dev/null; then
  DB_HOST=$(echo "$DATABASE_URL" | sed -E 's|.*@([^:/]+).*|\1|')
  DB_PORT=$(echo "$DATABASE_URL" | sed -E 's|.*:([0-9]+)/.*|\1|')
  if ! pg_isready -h "${DB_HOST:-localhost}" -p "${DB_PORT:-5432}" -q; then
    warn "PostgreSQL no responde en ${DB_HOST:-localhost}:${DB_PORT:-5432}"
    warn "Asegurate de que esté corriendo antes de continuar."
  else
    ok "PostgreSQL OK"
  fi
else
  warn "pg_isready no disponible — asumiendo que PostgreSQL está corriendo"
fi

# Verificar Redis
if command -v redis-cli &>/dev/null; then
  REDIS_HOST=$(echo "$REDIS_URL" | sed -E 's|redis://([^:/]+).*|\1|')
  REDIS_PORT=$(echo "$REDIS_URL" | sed -E 's|.*:([0-9]+).*|\1|')
  if ! redis-cli -h "${REDIS_HOST:-localhost}" -p "${REDIS_PORT:-6379}" ping &>/dev/null; then
    warn "Redis no responde — asegurate de que esté corriendo"
  else
    ok "Redis OK"
  fi
fi

# ─── 1. Generar .env.development ──────────────────────────────────────────────
section "Generando .env.development"

# Generar PII key segura
PII_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# Preservar PII key si ya existe un .env.development (para no romper datos cifrados)
if [ -f ".env.development" ] && grep -q "PII_ENCRYPTION_KEY=" .env.development; then
  EXISTING_PII=$(grep "PII_ENCRYPTION_KEY=" .env.development | cut -d'=' -f2)
  if [ -n "$EXISTING_PII" ] && [ "$EXISTING_PII" != "" ]; then
    PII_KEY="$EXISTING_PII"
    warn "PII_ENCRYPTION_KEY preservada del .env.development existente (rotarla rompería datos cifrados)"
  fi
fi

cat > .env.development << EOF
# =============================================================================
# .env.development — pasarela-pagos — MercadoPago Sandbox
# Generado por setup-pagos-mp-sandbox.sh el $(date -u '+%Y-%m-%dT%H:%M:%SZ')
# NO COMMITEAR — está en .gitignore
# =============================================================================

# ─── App ─────────────────────────────────────────────────────────────────────
NODE_ENV=development
PORT=${PORT}

# ─── Base de datos ────────────────────────────────────────────────────────────
DATABASE_URL="${DATABASE_URL}"

# ─── Redis ────────────────────────────────────────────────────────────────────
REDIS_URL="${REDIS_URL}"

# ─── Firebase ─────────────────────────────────────────────────────────────────
# En dev sin Firebase real: dejar vacío → FirebaseAuthGuard entra en modo degradado
# Para SSO completo: pegar el JSON de la service account del owner-dashboard
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=

# ─── PII Encryption (AES-256-GCM) ─────────────────────────────────────────────
# NUNCA rotarla sin migrar los datos cifrados
PII_ENCRYPTION_KEY=${PII_KEY}

# ─── MercadoPago Sandbox ──────────────────────────────────────────────────────
# Obtener en: mercadopago.com/developers/panel → Tu app → Credenciales → Modo prueba
MERCADOPAGO_ACCESS_TOKEN=${MP_ACCESS_TOKEN}
MERCADOPAGO_PUBLIC_KEY=${MP_PUBLIC_KEY}
# Secret para verificar firma HMAC de webhooks MP (configurar en MP Developers Panel)
MERCADOPAGO_WEBHOOK_SECRET=${MP_WEBHOOK_SECRET}

# ─── Otros providers (deshabilitados en sandbox) ─────────────────────────────
# Dejar vacíos — los providers no se registran si falta el access token
STRIPE_SECRET_KEY=
PAGARME_SECRET_KEY=
DLOCAL_API_KEY=
DLOCAL_SECRET_KEY=
CONEKTA_PRIVATE_KEY=

# ─── Throttling ───────────────────────────────────────────────────────────────
THROTTLE_TTL=60
THROTTLE_LIMIT=500
THROTTLE_LIMIT_PER_TENANT=500

# ─── CORS ─────────────────────────────────────────────────────────────────────
# Agregar las URLs del dashboard y ecommerce front en dev
CORS_ORIGINS=http://localhost:3000,http://localhost:3001,http://localhost:3002

# ─── OpenTelemetry (deshabilitado en dev por defecto) ─────────────────────────
OTEL_ENABLED=false
OTEL_SERVICE_NAME=pasarela-pagos-dev
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

# ─── Reconciliación ───────────────────────────────────────────────────────────
# Cada 5 minutos en dev (puede subirse a 1 min para pruebas)
RECONCILE_CRON=*/5 * * * *
EOF

ok ".env.development generado (port ${PORT})"
warn "Revisar CORS_ORIGINS si tus frontends corren en otros puertos"

# ─── 2. Instalar dependencias ─────────────────────────────────────────────────
section "Instalando dependencias"

pnpm install --frozen-lockfile 2>&1 | tail -3
ok "Dependencias instaladas"

# ─── 3. Migración de Prisma ───────────────────────────────────────────────────
section "Aplicando migraciones Prisma"

export DATABASE_URL
pnpm prisma migrate deploy
ok "Migraciones aplicadas"

pnpm prisma generate
ok "Prisma client generado"

# ─── 4. Seed personalizado para sandbox MP ───────────────────────────────────
section "Seeding datos de sandbox"

# El seed original crea tenant con cuid aleatorio.
# Necesitamos un Tenant cuyo id === ORG_ID del ecosistema.
# Usamos prisma db execute (SQL directo) para evitar reescribir seed.ts.

log "Creando Tenant con id = organizationId del ecosistema..."

# Hash bcrypt del API key de dev (10 rounds, igual que seed.ts)
# Usamos node inline para no depender de bcrypt en bash
BCRYPT_HASH=$(node -e "
const bcrypt = require('bcryptjs');
bcrypt.hash('${DEV_API_KEY}', 10).then(h => process.stdout.write(h));
")

# Upsert del Tenant usando psql o prisma db execute
# Detectamos si psql está disponible
if command -v psql &>/dev/null; then
  psql "$DATABASE_URL" << ENDSQL
-- Tenant con id === organizationId del owner-dashboard
INSERT INTO "Tenant" ("id", "name", "apiKeyHash", "active", "createdAt", "updatedAt")
VALUES (
  '${ORG_ID}',
  'Demo Org (MercadoPago Sandbox)',
  '${BCRYPT_HASH}',
  true,
  NOW(),
  NOW()
)
ON CONFLICT ("id") DO UPDATE
  SET "name"     = EXCLUDED."name",
      "active"   = true,
      "updatedAt" = NOW();

-- TenantApiKey vinculada al Tenant
INSERT INTO "TenantApiKey" (
  "id", "tenantId", "label", "keyHash", "prefix",
  "active", "createdAt", "updatedAt"
)
VALUES (
  'seed-key-sandbox-${ORG_ID}',
  '${ORG_ID}',
  'Sandbox dev key',
  '${BCRYPT_HASH}',
  'pk_test',
  true,
  NOW(),
  NOW()
)
ON CONFLICT ("id") DO UPDATE
  SET "active"    = true,
      "updatedAt" = NOW();

-- ProviderRoutes para MercadoPago Argentina (sandbox)
-- priority 100 = primera opción; fake tiene priority 1 (fallback)
INSERT INTO "ProviderRoute" (
  "id", "country", "currency", "method", "providerId", "priority", "active"
)
VALUES
  (gen_random_uuid()::text, 'AR', 'ARS', 'CARD',         'mercadopago', 100, true),
  (gen_random_uuid()::text, 'AR', 'ARS', 'WALLET',        'mercadopago', 100, true),
  (gen_random_uuid()::text, 'AR', 'ARS', 'QR',            'mercadopago', 100, true),
  (gen_random_uuid()::text, 'AR', 'ARS', 'BANK_TRANSFER', 'mercadopago',  90, true),
  -- Fake como fallback por si MP no está disponible o el circuit breaker se abre
  (gen_random_uuid()::text, 'AR', 'ARS', 'CARD',          'fake',          1, true)
ON CONFLICT ("country", "currency", "method", "providerId") DO UPDATE
  SET "priority" = EXCLUDED."priority",
      "active"   = true;

SELECT 'Tenant:' AS tipo, "id", "name" FROM "Tenant" WHERE "id" = '${ORG_ID}'
UNION ALL
SELECT 'ApiKey:', "id", "label" FROM "TenantApiKey" WHERE "tenantId" = '${ORG_ID}'
UNION ALL
SELECT 'Route:', "country" || '/' || "currency" || '/' || "method"::"text", "providerId"
FROM "ProviderRoute" WHERE "providerId" IN ('mercadopago', 'fake') ORDER BY 1;
ENDSQL
  ok "Seed ejecutado con psql"
else
  # Fallback: usar prisma db execute con heredoc
  warn "psql no disponible — usando pnpm prisma db execute"

  # Ejecutamos cada statement por separado (prisma db execute no soporta múltiples)
  pnpm prisma db execute --stdin << ENDSQL
INSERT INTO "Tenant" ("id", "name", "apiKeyHash", "active", "createdAt", "updatedAt")
VALUES ('${ORG_ID}', 'Demo Org (MercadoPago Sandbox)', '${BCRYPT_HASH}', true, NOW(), NOW())
ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name", "active" = true, "updatedAt" = NOW()
ENDSQL

  pnpm prisma db execute --stdin << ENDSQL
INSERT INTO "TenantApiKey" ("id", "tenantId", "label", "keyHash", "prefix", "active", "createdAt", "updatedAt")
VALUES ('seed-key-sandbox-${ORG_ID}', '${ORG_ID}', 'Sandbox dev key', '${BCRYPT_HASH}', 'pk_test', true, NOW(), NOW())
ON CONFLICT ("id") DO UPDATE SET "active" = true, "updatedAt" = NOW()
ENDSQL

  for METHOD in CARD WALLET QR; do
    pnpm prisma db execute --stdin << ENDSQL
INSERT INTO "ProviderRoute" ("id", "country", "currency", "method", "providerId", "priority", "active")
VALUES (gen_random_uuid()::text, 'AR', 'ARS', '${METHOD}', 'mercadopago', 100, true)
ON CONFLICT ("country", "currency", "method", "providerId") DO UPDATE SET "priority" = 100, "active" = true
ENDSQL
  done

  pnpm prisma db execute --stdin << ENDSQL
INSERT INTO "ProviderRoute" ("id", "country", "currency", "method", "providerId", "priority", "active")
VALUES (gen_random_uuid()::text, 'AR', 'ARS', 'CARD', 'fake', 1, true)
ON CONFLICT ("country", "currency", "method", "providerId") DO UPDATE SET "priority" = 1, "active" = true
ENDSQL

  ok "Seed ejecutado con prisma db execute"
fi

# ─── 5. Build rápido para verificar compilación ───────────────────────────────
section "Verificando compilación TypeScript"

pnpm run build 2>&1 | tail -5
ok "Build exitoso"

# ─── 6. Smoke test (si el servidor ya está corriendo) ─────────────────────────
section "Smoke test (requiere servidor corriendo en :${PORT})"

SMOKE_PASSED=0

# Health check
if curl -sf "http://localhost:${PORT}/api/v1/health/ready" -o /dev/null 2>/dev/null; then
  ok "Health ready ✓"
  SMOKE_PASSED=1

  # POST /payments — pago con MercadoPago sandbox
  IDEM_KEY="test-$(date +%s)-$$"
  CREATE_RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X POST "http://localhost:${PORT}/api/v1/payments" \
    -H "Content-Type: application/json" \
    -H "x-api-key: ${DEV_API_KEY}" \
    -H "x-organization-id: ${ORG_ID}" \
    -H "idempotency-key: ${IDEM_KEY}" \
    -d '{
      "amountMinor": 150000,
      "currency":    "ARS",
      "country":     "AR",
      "method":      "card",
      "customerId":  "test-customer-001",
      "email":       "test@example.com",
      "description": "Pago de prueba sandbox"
    }')

  HTTP_CODE=$(echo "$CREATE_RESPONSE" | tail -1)
  BODY=$(echo "$CREATE_RESPONSE" | head -n -1)

  if [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "200" ]; then
    ok "POST /payments → ${HTTP_CODE}"
    PAYMENT_ID=$(echo "$BODY" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).id||JSON.parse(d).data?.id||'')}catch{}})")
    if [ -n "$PAYMENT_ID" ]; then
      ok "Payment ID: ${PAYMENT_ID}"

      # GET /payments/:id
      GET_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
        "http://localhost:${PORT}/api/v1/payments/${PAYMENT_ID}" \
        -H "x-api-key: ${DEV_API_KEY}" \
        -H "x-organization-id: ${ORG_ID}")
      ok "GET /payments/${PAYMENT_ID} → ${GET_CODE}"

      # GET /payments (list)
      LIST_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
        "http://localhost:${PORT}/api/v1/payments?page=1&limit=5" \
        -H "x-api-key: ${DEV_API_KEY}" \
        -H "x-organization-id: ${ORG_ID}")
      ok "GET /payments → ${LIST_CODE}"
    fi
  else
    warn "POST /payments → ${HTTP_CODE}"
    warn "Body: ${BODY}"
    warn "Revisá logs del servidor — puede ser credencial MP inválida en sandbox"
  fi
else
  warn "Servidor no está corriendo en :${PORT} — smoke test omitido"
  warn "Levantá con: pnpm start:dev"
fi

# ─── 7. Instrucciones para webhooks con ngrok ─────────────────────────────────
section "Configuración de Webhooks MercadoPago"

echo -e "
${BOLD}Para recibir webhooks de MP en dev necesitás un túnel público:${NC}

  1. Instalá ngrok:  brew install ngrok  o  https://ngrok.com/download
  2. En una terminal: ${CYAN}ngrok http ${PORT}${NC}
  3. Copiá la URL https://xxxxx.ngrok.io
  4. En MP Developers Panel:
       Tu app → Webhooks → Agregar → URL de producción/sandbox:
       ${CYAN}https://xxxxx.ngrok.io/api/v1/webhooks/mercadopago${NC}
       Seleccionar topic: ${BOLD}Pagos (payment)${NC}
  5. MP te da un ${BOLD}Secret${NC} — ponelo en .env.development:
       ${CYAN}MERCADOPAGO_WEBHOOK_SECRET=tu-secret-aqui${NC}
  6. Reiniciá el servidor

${BOLD}Para simular un pago aprobado con tarjeta de prueba (sandbox AR):${NC}
  Número:     ${CYAN}5031 7557 3453 0604${NC}
  CVV:        ${CYAN}123${NC}
  Vto:        ${CYAN}11/25${NC}
  Titular:    ${CYAN}APRO${NC}  (simula aprobado)
  (Para rechazado: titular = OTHE)

${BOLD}Tarjetas de prueba completas:${NC}
  https://www.mercadopago.com.ar/developers/es/docs/your-integrations/test/cards
"

# ─── 8. Resumen final ─────────────────────────────────────────────────────────
section "Resumen"

echo -e "
${BOLD}Ecosistema configurado para pruebas con MercadoPago Sandbox:${NC}

  Tenant / org ID  : ${CYAN}${ORG_ID}${NC}
  API Key dev      : ${CYAN}${DEV_API_KEY}${NC}
  Puerto           : ${CYAN}${PORT}${NC}
  DB               : ${CYAN}${DATABASE_URL}${NC}

${BOLD}Comandos:${NC}
  Levantar servidor  : ${CYAN}pnpm start:dev${NC}
  Ver logs bonitos   : ${CYAN}pnpm start:dev 2>&1 | pnpm pino-pretty${NC}
  Swagger docs       : ${CYAN}http://localhost:${PORT}/docs${NC}
  Health             : ${CYAN}http://localhost:${PORT}/api/v1/health/ready${NC}
  Prisma Studio      : ${CYAN}pnpm prisma:studio${NC}

${BOLD}Headers para todas las llamadas:${NC}
  x-api-key         : ${CYAN}${DEV_API_KEY}${NC}
  x-organization-id : ${CYAN}${ORG_ID}${NC}

${BOLD}Ejemplo crear pago (copiar y pegar):${NC}
  ${CYAN}curl -X POST http://localhost:${PORT}/api/v1/payments \\
    -H 'Content-Type: application/json' \\
    -H 'x-api-key: ${DEV_API_KEY}' \\
    -H 'x-organization-id: ${ORG_ID}' \\
    -H 'idempotency-key: mi-pago-001' \\
    -d '{
      \"amountMinor\": 150000,
      \"currency\":    \"ARS\",
      \"country\":     \"AR\",
      \"method\":      \"card\",
      \"customerId\":  \"cliente-001\",
      \"email\":       \"cliente@test.com\",
      \"description\": \"Suscripción mensual\"
    }'${NC}

  ${YELLOW}Nota: amountMinor en centavos — 150000 = ARS 1500.00${NC}

${BOLD}Siguiente paso tras integrar MP:${NC}
  Conectar realsass-dashboard-front enviando:
    Authorization: Bearer <firebaseToken>
    x-organization-id: ${ORG_ID}
  (el TenantGuard acepta ambos métodos — api-key para dev, Bearer para SSO)
"

ok "Setup completo 🚀"