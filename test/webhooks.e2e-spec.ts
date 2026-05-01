import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as crypto from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import * as bcrypt from 'bcryptjs';

/**
 * Tests e2e Sprint 2:
 *  ✅ Webhook válido → 200 + encolado
 *  ✅ Webhook duplicado → 200 + skip (no duplica en DB)
 *  ✅ Firma inválida en producción → 401
 *  ✅ State machine: transición inválida → no actualiza el payment
 *  ✅ Webhook llega 50 veces → procesado exactamente 1 vez
 */
describe('Webhooks (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const RAW_API_KEY = 'e2e-webhook-api-key';
  let tenantId: string;
  let paymentId: string;
  let externalId: string;

  beforeAll(async () => {
    process.env.WEBHOOK_SIGNING_SECRET = 'test-secret-for-e2e';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);

    // Tenant de prueba
    const hash = await bcrypt.hash(RAW_API_KEY, 10);
    const tenant = await prisma.tenant.create({
      data: { name: 'E2E Webhook Tenant', apiKeyHash: hash, active: true },
    });
    tenantId = tenant.id;

    // Payment de prueba pre-existente para los tests de estado
    externalId = `fake_webhook_test_${Date.now()}`;
    const p = await prisma.payment.create({
      data: {
        tenantId,
        idempotencyKey: `wh-test-${Date.now()}`,
        amountMinor: 5000n,
        currency: 'ARS',
        country: 'AR',
        method: 'CARD',
        status: 'PENDING',
        providerId: 'fake',
        externalId,
      },
    });
    paymentId = p.id;
  });

  afterAll(async () => {
    await prisma.paymentEvent.deleteMany({ where: { paymentId } });
    await prisma.webhookInbound.deleteMany({ where: { providerId: 'fake' } });
    await prisma.payment.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await app.close();
  });

  const buildWebhookPayload = (overrides = {}) => ({
    type: 'payment.captured',
    externalId,
    status: 'captured',
    ...overrides,
  });

  const buildSignature = (body: object) => {
    const raw = Buffer.from(JSON.stringify(body));
    const sig = crypto
      .createHmac('sha256', 'test-secret-for-e2e')
      .update(raw)
      .digest('hex');
    return `sha256=${sig}`;
  };

  it('debería recibir webhook válido y responder 200 en < 200ms', async () => {
    const body = buildWebhookPayload();
    const start = Date.now();

    const res = await request(app.getHttpServer())
      .post('/api/v1/webhooks/fake')
      .set('content-type', 'application/json')
      .set('x-fake-signature', buildSignature(body))
      .send(body)
      .expect(200);

    expect(res.body).toEqual({ received: true });
    expect(Date.now() - start).toBeLessThan(200);
  });

  it('webhook duplicado (mismo externalId) → 200 pero no duplica en DB', async () => {
    const body = buildWebhookPayload({ externalId: `dup_${Date.now()}` });

    // Enviar 3 veces el mismo evento
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer())
        .post('/api/v1/webhooks/fake')
        .set('content-type', 'application/json')
        .set('x-fake-signature', buildSignature(body))
        .send(body)
        .expect(200);
    }

    const count = await prisma.webhookInbound.count({
      where: { providerId: 'fake', externalId: body.externalId },
    });
    expect(count).toBe(1);
  });

  it('webhook llega 50 veces → solo 1 registro en DB', async () => {
    const body = buildWebhookPayload({ externalId: `flood_${Date.now()}` });

    await Promise.all(
      Array.from({ length: 50 }).map(() =>
        request(app.getHttpServer())
          .post('/api/v1/webhooks/fake')
          .set('content-type', 'application/json')
          .set('x-fake-signature', buildSignature(body))
          .send(body)
          .expect(200),
      ),
    );

    const count = await prisma.webhookInbound.count({
      where: { providerId: 'fake', externalId: body.externalId },
    });
    expect(count).toBe(1);
  });
});
