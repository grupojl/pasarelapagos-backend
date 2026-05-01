#!/usr/bin/env bash
# =============================================================================
# fix-build-errors-2.sh
# Pasarela de Pagos — Corrige los 6 errores restantes del build
#
# Errores resueltos:
#   TS2688  @types/bcryptjs, cache-manager, uuid no encontrados (typeRoots)
#   TS2352  CustomerCreateInput / PaymentCreateInput (relación tenant anidada)
#   TS2322  PaymentMethodKind Prisma ENUM vs provider interface lowercase
#
# USO:
#   chmod +x fix-build-errors-2.sh
#   ./fix-build-errors-2.sh
# =============================================================================
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✔ $*${NC}"; }
warn() { echo -e "${YELLOW}⚠ $*${NC}"; }
die()  { echo -e "${RED}✘ $*${NC}"; exit 1; }
log()  { echo -e "\n${YELLOW}▶ $*${NC}"; }

[[ -f "package.json" ]] || die "Ejecutá desde la raíz del proyecto"

# =============================================================================
# FIX 1 — tsconfig.json
# TS2688: @types/* no encontrados porque typeRoots del fix anterior
# solo apuntaba a ./node_modules/@types y ./src/common/types.
# Solución: quitar typeRoots (innecesario) y agregar types[] explícito
# para que TypeScript resuelva los @types/* normalmente.
# =============================================================================
log "FIX 1 — tsconfig.json (TS2688 @types no encontrados)"

cat > tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "resolvePackageJsonExports": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2023",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strictNullChecks": true,
    "forceConsistentCasingInFileNames": true,
    "noImplicitAny": false,
    "strictBindCallApply": false,
    "noFallthroughCasesInSwitch": false
  }
}
EOF
ok "tsconfig.json restaurado sin typeRoots (los @types/* se resuelven automáticamente)"

# El module augmentation de express.d.ts no necesita typeRoots;
# alcanza con que el archivo exista en src/ y sea un .d.ts con export {}.
# Verificar que existe y tiene la forma correcta:
if [[ ! -f "src/common/types/express.d.ts" ]]; then
  warn "src/common/types/express.d.ts no existe — creando..."
  mkdir -p src/common/types
  cat > src/common/types/express.d.ts << 'EOF'
// src/common/types/express.d.ts
// Extiende el tipo Request de Express para los campos que inyectamos
// en FirebaseAuthGuard y TenantGuard.
import type { DecodedIdToken } from 'firebase-admin/auth';

declare global {
  namespace Express {
    interface Request {
      firebaseUser?: DecodedIdToken;
      user?: {
        uid:                string;
        email:              string;
        productPermissions: Record<string, { canRead: boolean; canWrite: boolean }>;
        organizations:      string[];
      };
      organizationId?: string;
      tenantContext?: {
        organizationId: string;
        userId:         string;
        canRead:        boolean;
        canWrite:       boolean;
      };
    }
  }
}

export {};
EOF
  ok "src/common/types/express.d.ts creado"
else
  ok "src/common/types/express.d.ts ya existe"
fi

# =============================================================================
# FIX 2 — payments.service.ts
# TS2352 Customer/Payment create: Prisma exige la relación como objeto anidado
#   MALO:  create: { tenantId: orgId, ... } as Prisma.CustomerCreateInput
#   BIEN:  usar CustomerUncheckedCreateInput (permite tenantId scalar directo)
#
# TS2322 PaymentMethodKind: Prisma usa CARD, la interfaz del provider usa 'card'
#   BIEN:  convertir lowercase → UPPER con un mapper antes de llamar Prisma
# =============================================================================
log "FIX 2 — payments.service.ts (TS2352 relaciones Prisma + TS2322 enum)"

cat > src/modules/payments/payments.service.ts << 'EOSERVICE'
// src/modules/payments/payments.service.ts
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderRegistry } from '../providers/provider.registry';
import { AuditService } from '../audit/audit.service';
import { MetricsService } from '../metrics/metrics.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { assertValidTransition } from './payment-state.machine';
import type { OrgContext } from '../../common/interfaces/org-context.interface';
import { PaymentStatus, Prisma } from '@prisma/client';
// Importamos el enum de Prisma con alias para no colisionar con el tipo del provider
import { PaymentMethodKind as PrismaPaymentMethodKind } from '@prisma/client';
import type { PaymentMethodKind as ProviderMethodKind } from '../providers/provider.interface';

// ---------------------------------------------------------------------------
// Mapper: convierte el value lowercase del provider al ENUM de Prisma
// Ejemplo: 'card' → PaymentMethodKind.CARD
// ---------------------------------------------------------------------------
const METHOD_MAP: Record<ProviderMethodKind, PrismaPaymentMethodKind> = {
  card:          PrismaPaymentMethodKind.CARD,
  wallet:        PrismaPaymentMethodKind.WALLET,
  bank_transfer: PrismaPaymentMethodKind.BANK_TRANSFER,
  cash_voucher:  PrismaPaymentMethodKind.CASH_VOUCHER,
  pix:           PrismaPaymentMethodKind.PIX,
  qr:            PrismaPaymentMethodKind.QR,
};

function toPrismaMethod(method: string): PrismaPaymentMethodKind {
  const mapped = METHOD_MAP[method as ProviderMethodKind];
  if (!mapped) throw new BadRequestException(`Método de pago inválido: ${method}`);
  return mapped;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma:   PrismaService,
    private readonly registry: ProviderRegistry,
    private readonly audit:    AuditService,
    private readonly metrics:  MetricsService,
  ) {}

  // ---------------------------------------------------------------------------
  // CREATE
  // ---------------------------------------------------------------------------
  async create(
    dto: CreatePaymentDto,
    idempotencyKey: string,
    ctx: OrgContext,
  ) {
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException(
        'Header idempotency-key requerido para crear pagos',
      );
    }

    const orgId = ctx.organizationId;
    const start = Date.now();

    // 1. Idempotencia nivel DB — filtrado por organizationId
    const existing = await this.prisma.payment.findFirst({
      where: {
        organizationId: orgId,
        idempotencyKey,
      } as Prisma.PaymentWhereInput,
    });
    if (existing) return this.serialize(existing);

    // 2. Routing
    const provider = this.registry.selectFor(dto.country, dto.currency);

    this.logger.log(
      `Pago org=${orgId} provider=${provider.id} ` +
      `${dto.amountMinor} ${dto.currency} ${dto.country}`,
    );

    this.metrics.incrementPending(dto.country);

    const prismaMethod = toPrismaMethod(dto.method);

    // 3. Crear Payment PENDING en DB
    const payment = await this.prisma.$transaction(async (tx) => {
      let customerId: string | undefined;

      if (dto.customerId) {
        // Usar UncheckedCreateInput: permite pasar tenantId/organizationId
        // como scalars sin necesitar el objeto de relación anidado.
        const customer = await tx.customer.upsert({
          where: {
            tenantId_externalId: {
              tenantId:   orgId,
              externalId: dto.customerId,
            },
          },
          update: {},
          create: {
            tenantId:       orgId,
            organizationId: orgId,
            externalId:     dto.customerId,
            email:          dto.email,
            country:        dto.country,
          } satisfies Prisma.CustomerUncheckedCreateInput,
        });
        customerId = customer.id;
      }

      const p = await tx.payment.create({
        data: {
          tenantId:       orgId,
          organizationId: orgId,
          idempotencyKey,
          amountMinor:    BigInt(dto.amountMinor),
          currency:       dto.currency,
          country:        dto.country,
          method:         prismaMethod,
          status:         PaymentStatus.PENDING,
          providerId:     provider.id,
          description:    dto.description,
          metadata:       dto.metadata as Prisma.InputJsonValue,
          ...(customerId ? { customerId } : {}),
        } satisfies Prisma.PaymentUncheckedCreateInput,
      });

      await tx.paymentEvent.create({
        data: {
          paymentId: p.id,
          type:      'payment.created',
          payload:   { providerId: provider.id, organizationId: orgId } satisfies Prisma.InputJsonValue,
        },
      });

      return p;
    });

    // 4. Llamar provider — usa el tipo lowercase del provider interface
    try {
      const result = await provider.createCharge({
        amountMinor:   BigInt(dto.amountMinor),
        currency:      dto.currency,
        country:       dto.country,
        customer:      { id: dto.customerId ?? payment.id, email: dto.email },
        description:   dto.description,
        method:        dto.method as ProviderMethodKind,
        idempotencyKey,
        returnUrl:     dto.returnUrl,
        metadata:      dto.metadata,
      });

      const finalStatus = this.mapProviderStatus(result.status);

      const updated = await this.prisma.$transaction(async (tx) => {
        const p = await tx.payment.update({
          where: { id: payment.id },
          data:  { externalId: result.externalId, status: finalStatus },
        });
        await tx.paymentEvent.create({
          data: {
            paymentId: payment.id,
            type:      `provider.${result.status}`,
            payload:   result.raw as Prisma.InputJsonValue,
          },
        });
        return p;
      });

      this.metrics.decrementPending(dto.country);
      this.metrics.recordPayment({
        provider:   provider.id,
        status:     finalStatus,
        country:    dto.country,
        method:     dto.method,
        durationMs: Date.now() - start,
      });

      await this.audit.log({
        tenantId:       orgId,
        organizationId: orgId,
        actorId:        ctx.userId,
        action:         'payment.created',
        resourceId:     updated.id,
        resourceType:   'Payment',
        after:          { status: finalStatus, providerId: provider.id },
      });

      return this.serialize(updated);
    } catch (err) {
      this.metrics.decrementPending(dto.country);
      await this.prisma.payment.update({
        where: { id: payment.id },
        data:  {
          status:         PaymentStatus.FAILED,
          failureCode:    'PROVIDER_ERROR',
          failureMessage: (err as Error).message,
        },
      });
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // LIST — siempre filtrado por organizationId
  // ---------------------------------------------------------------------------
  async findAll(
    ctx: OrgContext,
    query: { status?: PaymentStatus; page?: number; limit?: number },
  ) {
    const page  = query.page  ?? 1;
    const limit = query.limit ?? 20;
    const skip  = (page - 1) * limit;

    const where = {
      organizationId: ctx.organizationId,
      ...(query.status ? { status: query.status } : {}),
    } as Prisma.PaymentWhereInput;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.payment.count({ where }),
    ]);

    return {
      data: items.map((p) => this.serialize(p)),
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  // ---------------------------------------------------------------------------
  // FIND ONE — validar que pertenece a la org
  // ---------------------------------------------------------------------------
  async findOne(id: string, ctx: OrgContext) {
    const payment = await this.prisma.payment.findFirst({
      where:   { id, organizationId: ctx.organizationId } as Prisma.PaymentWhereInput,
      include: { events: { orderBy: { createdAt: 'asc' } } },
    });

    if (!payment) {
      throw new NotFoundException(`Payment ${id} no encontrado`);
    }

    return {
      ...this.serialize(payment),
      events: payment.events,
    };
  }

  // ---------------------------------------------------------------------------
  // REFUND
  // ---------------------------------------------------------------------------
  async refund(
    id: string,
    body: { amountMinor?: number; reason?: string },
    ctx: OrgContext,
  ) {
    const payment = await this.prisma.payment.findFirst({
      where: { id, organizationId: ctx.organizationId } as Prisma.PaymentWhereInput,
    });

    if (!payment) {
      throw new NotFoundException(`Payment ${id} no encontrado`);
    }

    if (
      payment.status !== PaymentStatus.CAPTURED &&
      payment.status !== PaymentStatus.PARTIALLY_REFUNDED
    ) {
      throw new BadRequestException(
        `No se puede refundar un pago en estado ${payment.status}`,
      );
    }

    if (!payment.externalId) {
      throw new BadRequestException('El pago no tiene externalId del provider');
    }

    const provider = this.registry.get(payment.providerId);

    const result = await provider.refund({
      externalId:  payment.externalId,
      amountMinor: body.amountMinor ? BigInt(body.amountMinor) : undefined,
      reason:      body.reason,
    });

    const newStatus =
      body.amountMinor && BigInt(body.amountMinor) < payment.amountMinor
        ? PaymentStatus.PARTIALLY_REFUNDED
        : PaymentStatus.REFUNDED;

    assertValidTransition(payment.status, newStatus);

    const [updatedPayment, refund] = await this.prisma.$transaction(async (tx) => {
      const p = await tx.payment.update({
        where: { id: payment.id },
        data:  { status: newStatus },
      });

      await tx.paymentEvent.create({
        data: {
          paymentId: payment.id,
          type:      'payment.refunded',
          payload:   {
            refundId: result.externalRefundId,
            amount:   body.amountMinor ?? payment.amountMinor.toString(),
            reason:   body.reason,
          } as Prisma.InputJsonValue,
        },
      });

      const r = await tx.refund.create({
        data: {
          paymentId:        payment.id,
          amountMinor:      body.amountMinor
            ? BigInt(body.amountMinor)
            : payment.amountMinor,
          reason:           body.reason,
          externalRefundId: result.externalRefundId,
          status:           'REFUNDED',
        },
      });

      return [p, r] as const;
    });

    await this.audit.log({
      tenantId:       payment.tenantId,
      organizationId: ctx.organizationId,
      actorId:        ctx.userId,
      action:         'payment.refunded',
      resourceId:     payment.id,
      resourceType:   'Payment',
      before:         { status: payment.status },
      after:          { status: newStatus, refundId: refund.id },
    });

    return {
      ...this.serialize(updatedPayment),
      refund: {
        id:               refund.id,
        amountMinor:      refund.amountMinor.toString(),
        externalRefundId: refund.externalRefundId,
        status:           refund.status,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------
  private serialize(payment: {
    id:              string;
    tenantId:        string;
    amountMinor:     bigint;
    currency:        string;
    country:         string;
    method:          PrismaPaymentMethodKind;
    status:          PaymentStatus;
    providerId:      string;
    externalId?:     string | null;
    description?:    string | null;
    metadata?:       unknown;
    failureCode?:    string | null;
    failureMessage?: string | null;
    idempotencyKey:  string;
    customerId?:     string | null;
    createdAt:       Date;
    updatedAt:       Date;
    [key: string]:   unknown;
  }) {
    return {
      ...payment,
      // BigInt serializado como string — contrato del ecosistema
      amountMinor: payment.amountMinor.toString(),
    };
  }

  private mapProviderStatus(status: string): PaymentStatus {
    const map: Record<string, PaymentStatus> = {
      authorized: PaymentStatus.AUTHORIZED,
      captured:   PaymentStatus.CAPTURED,
      failed:     PaymentStatus.FAILED,
      cancelled:  PaymentStatus.CANCELLED,
      pending:    PaymentStatus.PENDING,
    };
    return map[status] ?? PaymentStatus.PENDING;
  }
}
EOSERVICE
ok "payments.service.ts corregido (UncheckedCreateInput + method mapper)"

# =============================================================================
# RESUMEN
# =============================================================================
echo ""
echo -e "${GREEN}============================================================${NC}"
echo -e "${GREEN}  Fix 2 aplicado. Resumen:${NC}"
echo -e "${GREEN}============================================================${NC}"
echo ""
echo "  EDIT  tsconfig.json                      — typeRoots removido"
echo "  EDIT  src/modules/payments/payments.service.ts"
echo "        • CustomerUncheckedCreateInput / PaymentUncheckedCreateInput"
echo "          (permite tenantId scalar sin objeto relación anidado)"
echo "        • METHOD_MAP: convierte 'card' → CARD para Prisma enum"
echo "        • provider.createCharge() sigue recibiendo lowercase ('card')"
echo ""
echo -e "${YELLOW}Próximo paso:${NC}"
echo "  pnpm build"
echo ""
echo -e "${GREEN}============================================================${NC}"