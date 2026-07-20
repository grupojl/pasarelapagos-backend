#!/usr/bin/env bash
# =============================================================================
# fix-pagos-queue-names.sh
# Fix: BullMQ 5.x — "Queue name cannot contain :"
# Root cause: los nombres en src/common/constants/queues.ts usan ":" como
#             separador, pero BullMQ lo reserva para prefijos Redis internos.
# Solución: reemplazar ":" por "-" en los nombres de las queues.
#           Todos los @Processor y @InjectQueue referencian las constantes,
#           por lo que solo hay que tocar el archivo de constantes.
# Repo: pagos-back (src en raíz)
# =============================================================================
set -euo pipefail

FILE="src/common/constants/queues.ts"

echo "🔍  Verificando $FILE ..."

if [ ! -f "$FILE" ]; then
  echo "❌  No se encontró $FILE"
  echo "    Corré el script desde la raíz del repo pagos-back"
  exit 1
fi

# Idempotencia: si ya no tiene ":" en los valores de las constantes, no hacer nada
if ! grep -E "= '[^']*:[^']*'" "$FILE" > /dev/null 2>&1; then
  echo "⚠️  No se encontraron nombres con ':' — nada que hacer"
  exit 0
fi

# Backup
cp "$FILE" "${FILE}.bak"
echo "💾  Backup guardado en ${FILE}.bak"

cat > "$FILE" << 'TSEOF'
// src/common/constants/queues.ts
//
// IMPORTANTE: BullMQ 5.x reserva ":" para prefijos internos de Redis.
// Los nombres de queues NO pueden contener ":".
// Usar guiones como separador de namespace.

export const QUEUE_WEBHOOKS  = 'webhooks-process';
export const QUEUE_RECONCILE = 'payments-reconcile';
export const QUEUE_DLQ       = 'payments-dlq';

export const JOB_PROCESS_WEBHOOK   = 'process-webhook';
export const JOB_RECONCILE_PAYMENT = 'reconcile-payment';
TSEOF

echo "✅  queues.ts actualizado"
echo ""
echo "📄  Contenido final:"
cat "$FILE"
echo ""
echo "⚠️  NOTA: Si tenés jobs pendientes en Redis con los nombres anteriores"
echo "   ('webhooks:process', 'payments:reconcile', 'payments:dlq') no serán"
echo "   procesados con los nuevos nombres. En dev esto es aceptable."
echo "   En prod hacer el cambio en una ventana de mantenimiento."