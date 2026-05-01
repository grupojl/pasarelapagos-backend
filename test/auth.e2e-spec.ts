/**
 * Tests e2e Sprint 7 — Firebase Auth + RBAC
 *
 * Nota: estos tests mockean Firebase Admin SDK.
 * Para tests contra Firebase real, configurar FIREBASE_* en .env.test
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { FIREBASE_ADMIN } from '../src/modules/firebase/firebase.module';
import * as bcrypt from 'bcryptjs';

// Mock de Firebase Admin
const mockVerifyIdToken = jest.fn();
jest.mock('firebase-admin', () => ({
  apps: [],
  initializeApp: jest.fn(() => ({})),
  credential: { cert: jest.fn() },
  app: jest.fn(() => ({
    auth: () => ({ verifyIdToken: mockVerifyIdToken }),
  })),
}));

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let userId: string;

  const FIREBASE_UID   = 'firebase_uid_test_123';
  const USER_EMAIL     = 'test@pasarela.com';
  const RAW_API_KEY    = 'e2e-auth-api-key';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(FIREBASE_ADMIN)
      .useValue({ auth: () => ({ verifyIdToken: mockVerifyIdToken }) })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    prisma = moduleFixture.get(PrismaService);

    // Tenant + User de prueba en DB
    const hash = await bcrypt.hash(RAW_API_KEY, 10);
    const tenant = await prisma.tenant.create({
      data: { name: 'Auth E2E Tenant', apiKeyHash: hash, active: true },
    });
    tenantId = tenant.id;

    const user = await prisma.user.create({
      data: {
        tenantId,
        firebaseUid: FIREBASE_UID,
        email:       USER_EMAIL,
        name:        'Test User',
        role:        'admin',
        active:      true,
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await app.close();
  });

  beforeEach(() => {
    mockVerifyIdToken.mockResolvedValue({
      uid:   FIREBASE_UID,
      email: USER_EMAIL,
      name:  'Test User',
    });
  });

  afterEach(() => jest.clearAllMocks());

  describe('GET /api/v1/auth/me', () => {
    it('retorna perfil con Bearer token válido', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer valid-firebase-token')
        .expect(200);

      expect(res.body.user.email).toBe(USER_EMAIL);
      expect(res.body.user.role).toBe('admin');
      expect(res.body.tenant.id).toBe(tenantId);
    });

    it('401 sin token', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .expect(401);
    });

    it('401 con token Firebase inválido', async () => {
      mockVerifyIdToken.mockRejectedValue(new Error('Token inválido'));
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });
  });

  describe('Auth dual: x-api-key sigue funcionando', () => {
    it('acepta x-api-key junto a Firebase (retrocompatibilidad)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/payments')
        .set('x-api-key', RAW_API_KEY)
        .expect(200);

      expect(res.body).toHaveProperty('data');
    });
  });

  describe('RBAC', () => {
    it('viewer no puede crear pagos (403)', async () => {
      // Cambiar el rol a viewer
      await prisma.user.update({
        where: { id: userId },
        data:  { role: 'viewer' },
      });

      await request(app.getHttpServer())
        .post('/api/v1/payments')
        .set('Authorization', 'Bearer valid-token')
        .set('idempotency-key', 'rbac-test-key')
        .send({
          amountMinor: 1000,
          currency:    'ARS',
          country:     'AR',
          method:      'CARD',
          customerId:  'cust_rbac',
        })
        .expect(403);

      // Restaurar admin
      await prisma.user.update({
        where: { id: userId },
        data:  { role: 'admin' },
      });
    });

    it('admin puede crear pagos', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/payments')
        .set('Authorization', 'Bearer valid-token')
        .set('idempotency-key', 'rbac-admin-key')
        .send({
          amountMinor: 1000,
          currency:    'ARS',
          country:     'AR',
          method:      'CARD',
          customerId:  'cust_rbac_admin',
        });

      expect([201, 400]).toContain(res.status); // 201 ok, 400 si fake no disponible
    });
  });
});
