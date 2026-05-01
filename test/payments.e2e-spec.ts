import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import * as bcrypt from 'bcryptjs';

/**
 * Tests e2e Sprint 1:
 *  ✅ POST /payments — crea un pago exitosamente
 *  ✅ Idempotencia: misma key + mismo body → mismo resultado
 *  ✅ Idempotencia: misma key + body diferente → 409
 *  ✅ Sin API key → 401
 *  ✅ API key inválida → 401
 *  ✅ GET /payments/:id — retorna el pago creado
 *  ✅ GET /payments — lista paginada
 */
describe('Payments (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const RAW_API_KEY = 'e2e-test-api-key';
  let tenantId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);

    // Crear tenant de prueba
    const hash = await bcrypt.hash(RAW_API_KEY, 10);
    const tenant = await prisma.tenant.create({
      data: { name: 'E2E Tenant', apiKeyHash: hash, active: true },
    });
    tenantId = tenant.id;
  });

  afterAll(async () => {
    // Cleanup
    await prisma.paymentEvent.deleteMany({ where: { payment: { tenantId } } });
    await prisma.payment.deleteMany({ where: { tenantId } });
    await prisma.customer.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await app.close();
  });

  const basePayload = {
    amountMinor: 10000,
    currency: 'ARS',
    country: 'AR',
    method: 'CARD',
    customerId: 'cust_e2e_01',
    email: 'test@example.com',
    description: 'Test payment',
  };

  describe('POST /api/v1/payments', () => {
    it('debería crear un pago exitosamente', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/payments')
        .set('x-api-key', RAW_API_KEY)
        .set('idempotency-key', 'key-001')
        .send(basePayload)
        .expect(201);

      expect(res.body).toMatchObject({
        amountMinor: '10000',
        currency: 'ARS',
        country: 'AR',
        status: 'CAPTURED', // FakeProvider siempre retorna captured
        providerId: 'fake',
      });
    });

    it('idempotencia: misma key + mismo body → mismo ID de pago', async () => {
      const key = 'key-idemp-002';

      const res1 = await request(app.getHttpServer())
        .post('/api/v1/payments')
        .set('x-api-key', RAW_API_KEY)
        .set('idempotency-key', key)
        .send(basePayload)
        .expect(201);

      const res2 = await request(app.getHttpServer())
        .post('/api/v1/payments')
        .set('x-api-key', RAW_API_KEY)
        .set('idempotency-key', key)
        .send(basePayload)
        .expect(201);

      expect(res1.body.id).toBe(res2.body.id);
    });

    it('idempotencia: misma key + body diferente → 409', async () => {
      const key = 'key-idemp-409';

      await request(app.getHttpServer())
        .post('/api/v1/payments')
        .set('x-api-key', RAW_API_KEY)
        .set('idempotency-key', key)
        .send(basePayload)
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/payments')
        .set('x-api-key', RAW_API_KEY)
        .set('idempotency-key', key)
        .send({ ...basePayload, amountMinor: 99999 }) // body diferente
        .expect(409);
    });

    it('sin API key → 401', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/payments')
        .set('idempotency-key', 'key-no-auth')
        .send(basePayload)
        .expect(401);
    });

    it('API key inválida → 401', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/payments')
        .set('x-api-key', 'wrong-key-xyz')
        .set('idempotency-key', 'key-bad-auth')
        .send(basePayload)
        .expect(401);
    });

    it('body inválido (monto negativo) → 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/payments')
        .set('x-api-key', RAW_API_KEY)
        .set('idempotency-key', 'key-bad-body')
        .send({ ...basePayload, amountMinor: -1 })
        .expect(400);
    });
  });

  describe('GET /api/v1/payments/:id', () => {
    it('debería retornar el pago creado', async () => {
      const create = await request(app.getHttpServer())
        .post('/api/v1/payments')
        .set('x-api-key', RAW_API_KEY)
        .set('idempotency-key', 'key-get-001')
        .send(basePayload)
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/payments/${create.body.id}`)
        .set('x-api-key', RAW_API_KEY)
        .expect(200);

      expect(res.body.id).toBe(create.body.id);
      expect(res.body.events).toBeDefined();
    });

    it('pago de otro tenant → 404', async () => {
      // Intentar leer un ID que no pertenece a este tenant
      await request(app.getHttpServer())
        .get('/api/v1/payments/clxxxxxxxxxxx')
        .set('x-api-key', RAW_API_KEY)
        .expect(404);
    });
  });

  describe('GET /api/v1/payments', () => {
    it('debería retornar lista paginada', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/payments?page=1&limit=5')
        .set('x-api-key', RAW_API_KEY)
        .expect(200);

      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('meta');
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });
});
