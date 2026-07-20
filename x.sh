#!/usr/bin/env bash
# =============================================================================
# fix-railway-pnpm-builds-v2.sh
#
# Aplica el fix de pnpm build scripts para Railway en:
#   - chat-ia-lang        (chat-ia-back)
#   - pasarela-pagos      (pagos-back)
#
# Causa: pnpm 9+ / Corepack pnpm 11+ bloquea postinstall scripts por defecto.
# Fix:   "pnpm.onlyBuiltDependencies" en package.json + .npmrc
#
# USO — correr desde la raíz del repo correspondiente:
#   cd chat-ia-back   && bash fix-railway-pnpm-builds-v2.sh
#   cd pasarela-pagos && bash fix-railway-pnpm-builds-v2.sh
# =============================================================================

set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
log()  { echo -e "${CYAN}▶${NC} $1"; }
ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC}  $1"; }
fail() { echo -e "${RED}✗${NC} $1"; exit 1; }

# ─── Detectar proyecto ────────────────────────────────────────────────────────
if [ ! -f "package.json" ]; then
  fail "No se encontró package.json — corré desde la raíz del proyecto"
fi

PKG_NAME=$(node -e "process.stdout.write(require('./package.json').name || '')")

case "$PKG_NAME" in
  "chat-ia-lang")
    PROJECT_LABEL="chat-ia-back"
    # Lista exacta del error de Railway (primer build)
    ALLOWED_BUILDS='[
      "@firebase/util",
      "@nestjs/core",
      "@prisma/engines",
      "@scarf/scarf",
      "bcrypt",
      "msgpackr-extract",
      "prisma",
      "protobufjs",
      "unrs-resolver"
    ]'
    ;;
  "pasarela-pagos")
    PROJECT_LABEL="pasarela-pagos"
    # Lista exacta del error de Railway (segundo build)
    # Diferencias vs chat-ia: +argon2, +protobufjs@8.0.1, sin bcrypt (usa bcryptjs)
    ALLOWED_BUILDS='[
      "@firebase/util",
      "@nestjs/core",
      "@prisma/engines",
      "@scarf/scarf",
      "argon2",
      "msgpackr-extract",
      "prisma",
      "protobufjs",
      "unrs-resolver"
    ]'
    ;;
  *)
    fail "Proyecto no reconocido: '$PKG_NAME'. Esperado: 'chat-ia-lang' o 'pasarela-pagos'"
    ;;
esac

echo -e "\n${BOLD}Aplicando fix Railway pnpm builds → ${CYAN}${PROJECT_LABEL}${NC}\n"

# ─── 1. .npmrc ────────────────────────────────────────────────────────────────
log "Escribiendo .npmrc..."

cat > .npmrc << 'EOF'
# pnpm 9+ / Corepack pnpm 11+: habilita postinstall scripts en CI/Railway.
# Sin esto: [ERR_PNPM_IGNORED_BUILDS] bloquea la instalación.
enable-pre-post-scripts=true

# Peers automáticos sin prompts interactivos en CI
auto-install-peers=true

# Hoisted: node-gyp (argon2, bcrypt) encuentra los headers de Node en Railway
node-linker=hoisted
EOF

ok ".npmrc creado"

# ─── 2. Patch package.json ────────────────────────────────────────────────────
log "Actualizando package.json con pnpm.onlyBuiltDependencies..."

node - << JSEOF
const fs      = require('fs');
const pkgPath = './package.json';
const pkg     = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

if (!pkg.pnpm) pkg.pnpm = {};

pkg.pnpm.onlyBuiltDependencies = ${ALLOWED_BUILDS};

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log('  pnpm.onlyBuiltDependencies escrito en package.json');
JSEOF

ok "package.json actualizado"

# Verificar JSON válido
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))" \
  && ok "JSON válido"

# ─── 3. Mostrar resultado ─────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}── .npmrc ──────────────────────────────────────────────────────${NC}"
cat .npmrc
echo ""
echo -e "${BOLD}── pnpm.onlyBuiltDependencies (package.json) ───────────────────${NC}"
node -e "const p=require('./package.json'); console.log(JSON.stringify(p.pnpm, null, 2))"
echo ""

# ─── 4. Actualizar lockfile ───────────────────────────────────────────────────
if command -v pnpm &>/dev/null; then
  log "Regenerando pnpm-lock.yaml (--no-frozen-lockfile)..."
  pnpm install --no-frozen-lockfile 2>&1 | grep -E '(Progress|done|warn|ERR)' || true
  ok "Lockfile actualizado"
else
  warn "pnpm no disponible aquí — ejecutar manualmente:"
  warn "  pnpm install --no-frozen-lockfile"
fi

# ─── 5. Próximos pasos ────────────────────────────────────────────────────────
echo -e "
${BOLD}Próximos pasos:${NC}

  ${CYAN}git add package.json .npmrc pnpm-lock.yaml
  git commit -m 'fix: allow pnpm build scripts for native deps (Railway)'
  git push${NC}

${BOLD}Railway redesplegará automáticamente al detectar el push.${NC}

${BOLD}Si después sigue fallando con argon2 / node-gyp:${NC}
  Crear nixpacks.toml en la raíz del repo:

  ${CYAN}[phases.setup]
  nixPkgs = ['python3', 'gcc', 'make', 'libffi']${NC}

  Eso instala las herramientas de compilación que node-gyp necesita.
"

ok "Fix aplicado → ${PROJECT_LABEL} listo para redesplegar en Railway 🚀"