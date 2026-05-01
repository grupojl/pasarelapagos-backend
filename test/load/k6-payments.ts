/**
 * Load test con k6 — Pasarela de Pagos
 *
 * Escenarios:
 *   1. smoke:    1 VU x 30s       — verificar que el sistema responde
 *   2. load:     50 VU x 5min     — carga normal esperada
 *   3. stress:   ramp 0→200 VU    — encontrar el punto de quiebre
 *   4. spike:    burst de 500 VU  — simular pico repentino
 *
 * SLOs objetivos:
 *   p95 < 500ms
 *   p99 < 1000ms
 *   error rate < 1%
 *
 * Uso:
 *   k6 run --env API_URL=http://localhost:3000 --env API_KEY=test-api-key-dev-only test/load/k6-payments.ts
 *   k6 run --scenario=stress test/load/k6-payments.ts
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// --- Métricas custom -------------------------------------------------------
const errorRate         = new Rate('errors');
const paymentDuration   = new Trend('payment_duration', true);

// --- Config ----------------------------------------------------------------
const BASE_URL = __ENV.API_URL  ?? 'http://localhost:3000';
const API_KEY  = __ENV.API_KEY  ?? 'test-api-key-dev-only';

const HEADERS = {
  'Content-Type': 'application/json',
  'x-api-key':    API_KEY,
};

// --- Escenarios ------------------------------------------------------------
export const options = {
  scenarios: {
    smoke: {
      executor: 'constant-vus',
      vus: 1, duration: '30s',
      tags: { scenario: 'smoke' },
    },
    load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 50  },
        { duration: '4m',  target: 50  },
        { duration: '30s', target: 0   },
      ],
      tags: { scenario: 'load' },
    },
    stress: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m',  target: 100 },
        { duration: '2m',  target: 200 },
        { duration: '1m',  target: 0   },
      ],
      tags: { scenario: 'stress' },
    },
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 500 },
        { duration: '30s', target: 500 },
        { duration: '10s', target: 0   },
      ],
      tags: { scenario: 'spike' },
    },
  },
  thresholds: {
    // SLOs de producción
    'http_req_duration{name:create_payment}': ['p(95)<500', 'p(99)<1000'],
    'http_req_duration{name:get_payment}':    ['p(95)<200'],
    'http_req_duration{name:health_ready}':   ['p(95)<100'],
    'errors':                                 ['rate<0.01'],
    'http_req_failed':                        ['rate<0.01'],
  },
};

// --- Payloads de prueba ----------------------------------------------------
const COUNTRIES = [
  { country: 'AR', currency: 'ARS' },
  { country: 'BR', currency: 'BRL' },
  { country: 'MX', currency: 'MXN' },
  { country: 'US', currency: 'USD' },
];

function randomPayload() {
  const c = COUNTRIES[Math.floor(Math.random() * COUNTRIES.length)];
  return JSON.stringify({
    amountMinor: Math.floor(Math.random() * 100000) + 100,
    currency:    c.currency,
    country:     c.country,
    method:      'CARD',
    customerId:  `cust_k6_${Math.floor(Math.random() * 1000)}`,
    description: 'k6 load test payment',
  });
}

// --- Test principal --------------------------------------------------------
export default function () {
  // 1. Health check
  const healthRes = http.get(`${BASE_URL}/api/v1/health/ready`, {
    tags: { name: 'health_ready' },
  });
  check(healthRes, { 'health ready = 200': (r) => r.status === 200 });

  // 2. Crear pago
  const idempotencyKey = uuidv4();
  const createRes = http.post(
    `${BASE_URL}/api/v1/payments`,
    randomPayload(),
    {
      headers: { ...HEADERS, 'idempotency-key': idempotencyKey },
      tags: { name: 'create_payment' },
    },
  );

  const createOk = check(createRes, {
    'create payment 2xx': (r) => r.status >= 200 && r.status < 300,
    'has payment id':     (r) => {
      try { return !!(JSON.parse(r.body as string)).id; } catch { return false; }
    },
  });

  errorRate.add(!createOk);
  paymentDuration.add(createRes.timings.duration);

  if (!createOk) return;

  // 3. Leer el pago creado
  const paymentId = (JSON.parse(createRes.body as string)).id;
  const getRes = http.get(
    `${BASE_URL}/api/v1/payments/${paymentId}`,
    { headers: HEADERS, tags: { name: 'get_payment' } },
  );
  check(getRes, { 'get payment 200': (r) => r.status === 200 });

  // 4. Idempotencia: mismo key → mismo resultado
  const replayRes = http.post(
    `${BASE_URL}/api/v1/payments`,
    randomPayload(),
    {
      headers: { ...HEADERS, 'idempotency-key': idempotencyKey },
      tags: { name: 'create_payment' },
    },
  );
  check(replayRes, {
    'idempotent replay 2xx': (r) => r.status >= 200 && r.status < 300,
    'same payment id':       (r) => {
      try { return (JSON.parse(r.body as string)).id === paymentId; } catch { return false; }
    },
  });

  sleep(1);
}
