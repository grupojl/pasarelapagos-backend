#!/usr/bin/env bash
# =============================================================================
# fix-pagos-auth-module.sh
# Fix: AuthGuard no puede resolver ApiKeyService en AuthModule
# Root cause: AuthModule no importa TenantsModule (donde vive ApiKeyService)
#             y tampoco declara AuthGuard como provider
# Solución: importar TenantsModule y agregar AuthGuard a providers/exports
# Repo: pagos-back (src en raíz)
# =============================================================================
set -euo pipefail

FILE="src/modules/auth/auth.module.ts"

echo "🔍  Verificando $FILE ..."

if [ ! -f "$FILE" ]; then
  echo "❌  No se encontró $FILE"
  echo "    Corré el script desde la raíz del repo pagos-back"
  exit 1
fi

# Idempotencia
if grep -q "TenantsModule" "$FILE"; then
  echo "⚠️  TenantsModule ya está en auth.module.ts — nada que hacer"
  exit 0
fi

cp "$FILE" "${FILE}.bak"
echo "💾  Backup guardado en ${FILE}.bak"

cat > "$FILE" << 'TSEOF'
// src/modules/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { AuthController }      from './auth.controller';
import { FirebaseModule }      from '../firebase/firebase.module';
import { FirebaseAuthService } from '../firebase/firebase-auth.service';
import { TenantsModule }       from '../tenants/tenants.module';
import { AuthGuard }           from '../../common/guards/auth.guard';

@Module({
  imports:     [FirebaseModule, TenantsModule],
  controllers: [AuthController],
  providers:   [FirebaseAuthService, AuthGuard],
  exports:     [FirebaseAuthService, AuthGuard],
})
export class AuthModule {}
TSEOF

echo "✅  auth.module.ts actualizado"
echo ""
echo "📄  Contenido final:"
cat "$FILE"