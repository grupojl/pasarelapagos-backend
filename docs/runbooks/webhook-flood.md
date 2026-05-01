# Runbook: Webhook flood

## Síntomas
- Cola `webhooks:process` con miles de jobs pendientes
- Redis con uso de memoria elevado
- Latencia alta en el endpoint `/api/v1/webhooks/:provider`

## Diagnóstico rápido

```bash
# Ver estado de las colas BullMQ
# (instalar bull-board o usar redis-cli)
redis-cli LLEN "bull:webhooks:process:wait"

# Ver webhooks duplicados en las últimas 2hs
SELECT provider_id, COUNT(*) as total
FROM "WebhookInbound"
WHERE created_at > NOW() - INTERVAL '2 hours'
GROUP BY provider_id
ORDER BY total DESC;
```

## Acciones

### 1. Throttle del endpoint de webhooks

El sistema ya deduplica por `(providerId, externalId)` — el flood no crea procesamiento duplicado, pero puede saturar la cola.

Si el flood es legítimo (burst de pagos reales), el sistema lo maneja solo. Monitorear que el lag de procesamiento baje.

### 2. Si es un ataque / spam

```bash
# Bloquear IP a nivel infra (Cloudflare / nginx)
# Mientras tanto, pausar la cola para no saturar workers:
redis-cli RENAME "bull:webhooks:process:wait" "bull:webhooks:process:wait.paused"
```

### 3. Limpiar webhooks falsos

```sql
DELETE FROM "WebhookInbound"
WHERE status = 'received'
  AND created_at > NOW() - INTERVAL '1 hour'
  AND provider_id = 'fake_attacker';
```

## Prevención
- Rate limit por IP en Cloudflare (50 req/s por IP al endpoint /webhooks)
- Validación de firma HMAC rechaza eventos sin firma válida
