#!/usr/bin/env bash
# =============================================================================
# fix-railway-final.sh
#
# Solución definitiva para ambos repos.
#
# CAUSA RAÍZ (después de analizar los XMLs):
#   Ningún package.json tiene "packageManager" definido.
#   → Corepack descarga pnpm@latest = pnpm 11
#   → pnpm 11 ignora package.json["pnpm"] Y requiere pnpm-workspace.yaml
#   → el pnpm-workspace.yaml generado localmente no se committea con
#     el lockfile correcto → Railway sigue fallando
#
# FIX:
#   1. Fijar "packageManager": "pnpm@10.11.0" en package.json
#      → Corepack usa exactamente esa versión (no pnpm 11)
#      → pnpm 10 SÍ lee package.json["pnpm"].onlyBuiltDependencies
#   2. Agregar pnpm.onlyBuiltDependencies con la lista exacta del error
#   3. Regenerar lockfile con pnpm 10
#   4. Borrar pnpm-workspace.yaml si existe (no lo necesitamos más)
#
# USO:
#   cd chat-ia-back   && bash fix-railway-final.sh
#   cd pasarela-pagos && bash fix-railway-final.sh
# =============================================================================

set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
log()  { echo -e "${CYAN}▶${NC} $1"; }
ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC}  $1"; }
fail() { echo -e "${RED}✗${NC} $1"; exit 1; }

[ -f "package.json" ] || fail "No se encontró package.json"

PKG_NAME=$(node -e "process.stdout.write(require('./package.json').name || '')")

case "$PKG_NAME" in
  "chat-ia-lang")
    LABEL="chat-ia-back"
    BUILT_DEPS='["@firebase/util","@nestjs/core","@prisma/engines","@scarf/scarf","bcrypt","msgpackr-extract","prisma","protobufjs","unrs-resolver"]'
    ;;
  "pasarela-pagos")
    LABEL="pasarela-pagos"
    BUILT_DEPS='["@firebase/util","@nestjs/core","@prisma/engines","@scarf/scarf","argon2","msgpackr-extract","prisma","protobufjs","unrs-resolver"]'
    ;;
  *)
    fail "Repo no reconocido: '$PKG_NAME'"
    ;;
esac

echo -e "\n${BOLD}Fix Railway definitivo → ${CYAN}${LABEL}${NC}\n"

# ─── 1. Patchear package.json ─────────────────────────────────────────────────
log "Actualizando package.json..."

node - << JSEOF
const fs  = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

// Fijar versión de pnpm — Corepack usará EXACTAMENTE esta, no pnpm@latest
pkg.packageManager = 'pnpm@10.11.0';

// pnpm 10 SÍ lee esta sección de package.json
pkg.pnpm = {
  onlyBuiltDependencies: ${BUILT_DEPS}
};

fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
console.log('  packageManager: pnpm@10.11.0');
console.log('  pnpm.onlyBuiltDependencies:', ${BUILT_DEPS}.join(', '));
JSEOF

ok "package.json actualizado"

# ─── 2. Borrar pnpm-workspace.yaml si existe (limpieza) ──────────────────────
if [ -f "pnpm-workspace.yaml" ]; then
  rm pnpm-workspace.yaml
  ok "pnpm-workspace.yaml eliminado (ya no necesario)"
fi

# ─── 3. Borrar .npmrc si existe (limpieza) ───────────────────────────────────
if [ -f ".npmrc" ]; then
  rm .npmrc
  ok ".npmrc eliminado"
fi

# ─── 4. Activar pnpm 10 con corepack y regenerar lockfile ────────────────────
log "Activando pnpm@10.11.0 con corepack..."
corepack prepare pnpm@10.11.0 --activate 2>/dev/null || {
  warn "corepack prepare falló — intentando con npm install -g pnpm@10.11.0"
  npm install -g pnpm@10.11.0 --quiet
}

PNPM_VERSION=$(pnpm --version 2>/dev/null || echo "desconocida")
ok "pnpm activo: $PNPM_VERSION"

log "Regenerando pnpm-lock.yaml con pnpm 10..."
pnpm install --no-frozen-lockfile 2>&1 | tail -5
ok "Lockfile regenerado con pnpm 10"

# ─── 5. Verificar que el lockfile tiene los build approvals ──────────────────
log "Verificando lockfile..."
if grep -q "onlyBuiltDependencies\|neverBuiltDependencies" pnpm-lock.yaml 2>/dev/null; then
  ok "Lockfile contiene configuración de build scripts"
else
  warn "Lockfile no muestra onlyBuiltDependencies explícito — normal en pnpm 10 (se lee de package.json en runtime)"
fi

# ─── 6. Mostrar resultado final ───────────────────────────────────────────────
echo ""
echo -e "${BOLD}── package.json (secciones relevantes) ────────────────────────${NC}"
node -e "
const p = require('./package.json');
console.log('packageManager:', p.packageManager);
console.log('pnpm.onlyBuiltDependencies:', JSON.stringify(p.pnpm?.onlyBuiltDependencies, null, 2));
"
echo ""

# ─── 7. Próximos pasos ────────────────────────────────────────────────────────
echo -e "
${BOLD}Archivos a commitear:${NC}
  ${CYAN}git add package.json pnpm-lock.yaml
  git rm --cached pnpm-workspace.yaml .npmrc 2>/dev/null || true
  git commit -m 'fix: pin pnpm@10.11.0 via packageManager + onlyBuiltDependencies'
  git push${NC}

${BOLD}Por qué funciona ahora:${NC}
  - packageManager fijado → Corepack usa pnpm 10, no descarga pnpm 11
  - pnpm 10 lee package.json[\"pnpm\"].onlyBuiltDependencies sin necesitar workspace.yaml
  - lockfile regenerado con pnpm 10 → --frozen-lockfile pasa en Railway
"

ok "${LABEL} → listo para Railway 🚀"