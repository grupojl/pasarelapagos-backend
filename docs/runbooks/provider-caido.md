# Runbook: Provider caído

## Síntomas
- Pagos con `status: FAILED` y `failureCode: PROVIDER_UNAVAILABLE`
- Circuit breaker abierto en `/api/v1/health/ready`
- Alertas de `provider_circuit_breaker_open{provider="X"} = 1`

## Diagnóstico rápido

```bash
# Ver estado de todos los circuit breakers
curl https://api.tuapp.com/api/v1/health/ready | jq

# Ver últimos pagos fallidos
SELECT id, provider_id, failure_code, failure_message, created_at
FROM "Payment"
WHERE status = 'FAILED'
  AND created_at > NOW() - INTERVAL '30 minutes'
ORDER BY created_at DESC
LIMIT 20;

# Ver logs del provider
pnpm logs | grep "providerId=stripe" | tail -50
```

## Acciones

### 1. Activar fallback inmediato (sin redeploy)

```sql
-- Deshabilitar el provider caído temporalmente
UPDATE "ProviderRoute"
SET active = false
WHERE provider_id = 'stripe'  -- cambiar por el provider caído
  AND country = 'US';

-- Subir prioridad del fallback
UPDATE "ProviderRoute"
SET priority = 200
WHERE provider_id = 'dlocal'
  AND country = 'US';
```

El cache de rutas expira en 5 minutos. Para forzar reload inmediato, reiniciar la instancia.

### 2. Reanudar cuando el provider se recupera

```sql
UPDATE "ProviderRoute"
SET active = true, priority = 100
WHERE provider_id = 'stripe';
```

### 3. Reconciliar pagos perdidos

```bash
# Los pagos PENDING > 30 min se reconcilian automáticamente (cron cada 5min).
# Para forzar reconciliación manual de un pago específico:
curl -X POST https://api.tuapp.com/api/v1/admin/reconcile/PAYMENT_ID \
  -H "x-api-key: $ADMIN_KEY"
```

## Escalada
Si el provider lleva > 2h caído: contactar soporte del provider y notificar clientes afectados.
