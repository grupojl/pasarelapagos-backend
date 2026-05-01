import { Injectable, OnModuleInit } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import { Counter, Histogram, UpDownCounter } from '@opentelemetry/api';

/**
 * Métricas custom del negocio.
 *
 * payments_total{provider, status, country, method}
 * payment_duration_ms{provider, country}
 * webhook_processed_total{provider, status}
 * webhook_lag_ms{provider}
 * provider_circuit_breaker_state{provider, state}
 * active_payments_pending{country}
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  private paymentsTotal!:        Counter;
  private paymentDuration!:      Histogram;
  private webhookTotal!:         Counter;
  private webhookLag!:           Histogram;
  private circuitBreakerState!:  UpDownCounter;
  private activePending!:        UpDownCounter;

  onModuleInit() {
    const meter = metrics.getMeter('pasarela-pagos', '1.0.0');

    this.paymentsTotal = meter.createCounter('payments_total', {
      description: 'Total de pagos procesados por provider/status/país/método',
    });

    this.paymentDuration = meter.createHistogram('payment_duration_ms', {
      description: 'Duración del flujo de pago en ms',
      unit: 'ms',
      advice: { explicitBucketBoundaries: [50, 100, 250, 500, 1000, 2500, 5000, 10000] },
    });

    this.webhookTotal = meter.createCounter('webhook_processed_total', {
      description: 'Total de webhooks procesados por provider',
    });

    this.webhookLag = meter.createHistogram('webhook_lag_ms', {
      description: 'Tiempo entre creación del webhook y procesamiento',
      unit: 'ms',
      advice: { explicitBucketBoundaries: [100, 500, 1000, 5000, 15000, 60000] },
    });

    this.circuitBreakerState = meter.createUpDownCounter('provider_circuit_breaker_open', {
      description: '1 si el circuit breaker está abierto, 0 si cerrado',
    });

    this.activePending = meter.createUpDownCounter('active_payments_pending', {
      description: 'Pagos en estado PENDING actualmente',
    });
  }

  recordPayment(attrs: {
    provider: string;
    status: string;
    country: string;
    method: string;
    durationMs: number;
  }) {
    this.paymentsTotal.add(1, {
      provider: attrs.provider,
      status:   attrs.status,
      country:  attrs.country,
      method:   attrs.method,
    });

    this.paymentDuration.record(attrs.durationMs, {
      provider: attrs.provider,
      country:  attrs.country,
    });
  }

  recordWebhook(attrs: { provider: string; status: 'processed' | 'failed'; lagMs: number }) {
    this.webhookTotal.add(1, { provider: attrs.provider, status: attrs.status });
    this.webhookLag.record(attrs.lagMs, { provider: attrs.provider });
  }

  setCircuitBreakerOpen(provider: string, isOpen: boolean) {
    // OTel UpDownCounter: +1 cuando se abre, -1 cuando se cierra
    this.circuitBreakerState.add(isOpen ? 1 : -1, { provider });
  }

  incrementPending(country: string)  { this.activePending.add( 1, { country }); }
  decrementPending(country: string)  { this.activePending.add(-1, { country }); }
}
