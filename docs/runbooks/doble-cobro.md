# Runbook: Doble cobro

## Síntomas
- Cliente reporta dos débitos en su tarjeta por el mismo concepto
- Dos payments con el mismo `externalId` o mismo monto/cliente/fecha

## Diagnóstico

```sql
-- Buscar posibles duplicados por customer + monto + fecha
SELECT
  p1.id,
  p2.id as duplicate_id,
  p1.tenant_id,
  p1.customer_id,
  p1.amount_minor,
  p1.created_at,
  p2.created_at as dup_created_at
FROM "Payment" p1
JOIN "Payment" p2
  ON p1.customer_id = p2.customer_id
  AND p1.amount_minor = p2.amount_minor
  AND p1.id != p2.id
  AND ABS(EXTRACT(EPOCH FROM (p1.created_at - p2.created_at))) < 300 -- 5 min
WHERE p1.status = 'CAPTURED'
  AND p2.status = 'CAPTURED'
ORDER BY p1.created_at DESC;
```

## Acciones

### 1. Verificar idempotencia
Si ambos pagos tienen la misma `idempotencyKey` → bug del cliente (no respetó el contrato). Hacer refund del segundo cobro.

Si tienen distinta key pero mismo monto → posible bug del cliente que no reusó la key. Verificar con el cliente.

### 2. Emitir refund del duplicado

```bash
curl -X POST https://api.tuapp.com/api/v1/payments/PAYMENT_ID/refund \
  -H "x-api-key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"reason": "duplicate", "full": true}'
```

### 3. Notificar al cliente
Enviar comunicación con el ID del refund y fecha estimada de acreditación (3-5 días hábiles).

## Prevención
- Idempotency-Key obligatoria en POST /payments
- Validación doble: Redis (TTL 24h) + DB UNIQUE constraint
- Monitoreo: alerta si un customer tiene > 2 pagos capturados en < 5 min
