/**
 * OpenTelemetry — debe importarse ANTES que cualquier otro módulo.
 *
 * Variables de entorno:
 *   OTEL_ENABLED=true
 *   OTEL_EXPORTER_OTLP_ENDPOINT  → ej: http://localhost:4318
 *   OTEL_SERVICE_NAME            → ej: pasarela-pagos
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

// En @opentelemetry/resources v2 el export nombrado "Resource" puede no existir
// según el entrypoint que resuelve el bundler con "module": "nodenext".
// Lo importamos con require() desde el CJS para garantizar que es un valor,
// con un fallback a objeto vacío si el entorno no tiene OTel configurado.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const otelResources = require('@opentelemetry/resources');
const ResourceClass  = otelResources.Resource ?? otelResources.default?.Resource ?? null;

let sdk: NodeSDK | null = null;

export function startTelemetry(): void {
  if (process.env.OTEL_ENABLED !== 'true') return;
  if (!ResourceClass) {
    console.warn('[OTel] Resource no disponible — telemetría deshabilitada.');
    return;
  }

  const resource = new ResourceClass({
    [ATTR_SERVICE_NAME]:    process.env.OTEL_SERVICE_NAME ?? 'pasarela-pagos',
    [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? '0.0.1',
    environment:            process.env.NODE_ENV ?? 'development',
  });

  sdk = new NodeSDK({
    resource,
    traceExporter: new OTLPTraceExporter({
      url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318'}/v1/traces`,
    }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318'}/v1/metrics`,
      }),
      exportIntervalMillis: 15_000,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-http':    { enabled: true },
        '@opentelemetry/instrumentation-express': { enabled: true },
        '@opentelemetry/instrumentation-pg':      { enabled: true },
        '@opentelemetry/instrumentation-ioredis': { enabled: true },
        '@opentelemetry/instrumentation-fs':      { enabled: false },
      }),
    ],
  });

  sdk.start();
  console.log('[OTel] Telemetría iniciada.');
}

export async function stopTelemetry(): Promise<void> {
  if (sdk) await sdk.shutdown();
}
