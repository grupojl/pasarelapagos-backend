import { PrismaClient, PaymentMethodKind } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';

const prisma = new PrismaClient();

async function main() {
  // --- Tenant de dev ---
  const RAW_KEY   = 'test-api-key-dev-only';

  // Mantener compatibilidad con Sprint 1: apiKeyHash en Tenant
  const legacyHash = await bcrypt.hash(RAW_KEY, 10);

  const tenant = await prisma.tenant.upsert({
    where:  { apiKeyHash: legacyHash },
    update: {},
    create: { name: 'Demo Tenant', apiKeyHash: legacyHash, active: true },
  });
  console.log(`✅ Tenant: ${tenant.id}`);

  // --- TenantApiKey (Sprint 6) ---
  const prefix  = RAW_KEY.slice(0, 8);
  const keyHash = await bcrypt.hash(RAW_KEY, 10);

  await prisma.tenantApiKey.upsert({
    where:  { id: `seed-key-${tenant.id}` },
    update: {},
    create: {
      id:       `seed-key-${tenant.id}`,
      tenantId: tenant.id,
      label:    'Dev seed key',
      keyHash,
      prefix,
      active:   true,
    },
  });
  console.log(`✅ TenantApiKey creada — prefix: ${prefix}`);

  // --- ProviderRoutes ---
  const routes = [
    { country: 'AR', currency: 'ARS', method: PaymentMethodKind.CARD,         providerId: 'mercadopago', priority: 100 },
    { country: 'AR', currency: 'ARS', method: PaymentMethodKind.WALLET,        providerId: 'mercadopago', priority: 100 },
    { country: 'AR', currency: 'ARS', method: PaymentMethodKind.QR,            providerId: 'mercadopago', priority: 100 },
    { country: 'BR', currency: 'BRL', method: PaymentMethodKind.CARD,          providerId: 'pagarme',     priority: 100 },
    { country: 'BR', currency: 'BRL', method: PaymentMethodKind.PIX,           providerId: 'pagarme',     priority: 100 },
    { country: 'MX', currency: 'MXN', method: PaymentMethodKind.CARD,          providerId: 'conekta',     priority: 100 },
    { country: 'MX', currency: 'MXN', method: PaymentMethodKind.CASH_VOUCHER,  providerId: 'conekta',     priority: 100 },
    { country: 'PE', currency: 'PEN', method: PaymentMethodKind.CARD,          providerId: 'dlocal',      priority: 100 },
    { country: 'CL', currency: 'CLP', method: PaymentMethodKind.CARD,          providerId: 'dlocal',      priority: 100 },
    { country: 'CO', currency: 'COP', method: PaymentMethodKind.CARD,          providerId: 'dlocal',      priority: 100 },
    { country: 'US', currency: 'USD', method: PaymentMethodKind.CARD,          providerId: 'stripe',      priority: 100 },
    // Fake para dev/test
    { country: 'AR', currency: 'ARS', method: PaymentMethodKind.CARD,          providerId: 'fake',        priority: 1   },
    { country: 'BR', currency: 'BRL', method: PaymentMethodKind.PIX,           providerId: 'fake',        priority: 1   },
  ];

  for (const route of routes) {
    await prisma.providerRoute.upsert({
      where:  { country_currency_method_providerId: { country: route.country, currency: route.currency, method: route.method, providerId: route.providerId } },
      update: { priority: route.priority, active: true },
      create: { ...route, active: true },
    });
  }

  console.log(`✅ ${routes.length} ProviderRoutes configuradas`);
  console.log(`\n🔑 API Key dev: ${RAW_KEY}`);
  console.log(`📖 Docs: http://localhost:3000/docs`);
  console.log(`\n🔐 Generar PII_ENCRYPTION_KEY:`);
  console.log(`   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
