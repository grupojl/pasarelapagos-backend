// src/modules/audit/audit.service.ts
// Audit log inmutable (append-only).
// Nunca se borran ni modifican registros — compliance PCI-DSS.
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

export type AuditAction =
  | 'payment.created'
  | 'payment.captured'
  | 'payment.failed'
  | 'payment.cancelled'
  | 'payment.refunded'
  | 'payment.status_changed'
  | 'webhook.received'
  | 'webhook.processed'
  | 'apikey.created'
  | 'apikey.revoked'
  | 'tenant.created';

export interface AuditEntry {
  tenantId:        string;
  organizationId?: string;
  actorId?:        string;
  action:          AuditAction;
  resourceId:      string;
  resourceType:    string;
  before?:         Record<string, unknown>;
  after?:          Record<string, unknown>;
  metadata?:       Record<string, unknown>;
  ip?:             string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry): Promise<void> {
    try {
      // organizationId es un campo del schema Sprint-8.
      // Si el cliente Prisma ya fue regenerado tras la migración, el campo
      // está disponible directamente. El cast `as Prisma.AuditLogCreateInput`
      // permite compilar antes de que la migración esté aplicada.
      const data = {
        tenantId:       entry.tenantId,
        organizationId: entry.organizationId ?? entry.tenantId,
        actorId:        entry.actorId,
        action:         entry.action,
        resourceId:     entry.resourceId,
        resourceType:   entry.resourceType,
        before:         entry.before   as Prisma.InputJsonValue | undefined,
        after:          entry.after    as Prisma.InputJsonValue | undefined,
        metadata:       entry.metadata as Prisma.InputJsonValue | undefined,
        ip:             entry.ip,
      } as Prisma.AuditLogCreateInput;

      await this.prisma.auditLog.create({ data });
    } catch (err) {
      // El audit log NUNCA debe romper el flujo principal
      this.logger.error(`Error al escribir audit log: ${err}`);
    }
  }

  async findByOrg(organizationId: string, limit = 100) {
    return this.prisma.auditLog.findMany({
      // organizationId disponible post-migración sprint8
      where:   { organizationId } as Prisma.AuditLogWhereInput,
      orderBy: { createdAt: 'desc' },
      take:    limit,
    });
  }

  async findByResource(resourceId: string, organizationId: string) {
    return this.prisma.auditLog.findMany({
      where:   { resourceId, organizationId } as Prisma.AuditLogWhereInput,
      orderBy: { createdAt: 'asc' },
    });
  }
}
