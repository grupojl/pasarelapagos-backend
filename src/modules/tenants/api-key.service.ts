import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface CreateApiKeyResult {
  id:        string;
  rawKey:    string; // solo se muestra UNA vez al crear
  prefix:    string;
  expiresAt: Date | null;
}

/**
 * Gestión de API keys por tenant.
 *
 * - Múltiples keys activas por tenant (para rotación sin downtime).
 * - La key cruda NUNCA se almacena — solo el hash bcrypt.
 * - El prefijo (primeros 8 chars) se guarda para identificación.
 * - Soporte de expiración configurable.
 *
 * Formato de key: pk_{prefix}_{random}
 *   Ejemplo: pk_a1b2c3d4_kN8xQzP2mRvL...
 */
@Injectable()
export class ApiKeyService {
  private readonly logger = new Logger(ApiKeyService.name);
  private readonly HASH_ROUNDS = 10;
  private readonly PREFIX_LEN  = 8;

  constructor(
    private readonly prisma:  PrismaService,
    private readonly audit:   AuditService,
    private readonly config:  ConfigService,
  ) {}

  /**
   * Crea una nueva API key para un tenant.
   * La rawKey se muestra UNA sola vez — no se puede recuperar después.
   */
  async create(
    tenantId:   string,
    label:      string,
    expiresInDays?: number,
  ): Promise<CreateApiKeyResult> {
    const random  = nanoid(32);
    const prefix  = random.slice(0, this.PREFIX_LEN);
    const rawKey  = `pk_${prefix}_${random}`;
    const hash    = await bcrypt.hash(rawKey, this.HASH_ROUNDS);
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const apiKey = await this.prisma.tenantApiKey.create({
      data: {
        tenantId,
        label,
        keyHash: hash,
        prefix,
        expiresAt,
        active: true,
      },
    });

    await this.audit.log({
      tenantId,
      action:       'apikey.created',
      resourceId:   apiKey.id,
      resourceType: 'TenantApiKey',
      after:        { label, prefix, expiresAt },
    });

    this.logger.log(`API key creada para tenant ${tenantId}: prefix=${prefix}`);

    return {
      id:        apiKey.id,
      rawKey,            // solo se retorna acá, nunca más
      prefix,
      expiresAt,
    };
  }

  /**
   * Revoca una API key específica.
   */
  async revoke(keyId: string, tenantId: string): Promise<void> {
    const key = await this.prisma.tenantApiKey.findFirst({
      where: { id: keyId, tenantId },
    });
    if (!key) throw new NotFoundException('API key no encontrada');

    await this.prisma.tenantApiKey.update({
      where: { id: keyId },
      data:  { active: false, revokedAt: new Date() },
    });

    await this.audit.log({
      tenantId,
      action:       'apikey.revoked',
      resourceId:   keyId,
      resourceType: 'TenantApiKey',
      before:       { active: true },
      after:        { active: false },
    });

    this.logger.log(`API key revocada: ${keyId} tenant=${tenantId}`);
  }

  /**
   * Lista las API keys de un tenant (sin exponer los hashes).
   */
  async list(tenantId: string) {
    return this.prisma.tenantApiKey.findMany({
      where:   { tenantId },
      orderBy: { createdAt: 'desc' },
      select: {
        id:        true,
        label:     true,
        prefix:    true,
        active:    true,
        expiresAt: true,
        revokedAt: true,
        lastUsedAt:true,
        createdAt: true,
      },
    });
  }

  /**
   * Valida una raw key y retorna el tenant si es válida.
   * Actualiza lastUsedAt en background.
   */
  async validate(rawKey: string): Promise<{ id: string; name: string } | null> {
    if (!rawKey.startsWith('pk_')) return null;

    const prefix = rawKey.slice(3, 3 + this.PREFIX_LEN);

    // Buscar keys activas con ese prefix (reduce comparaciones bcrypt)
    const candidates = await this.prisma.tenantApiKey.findMany({
      where: {
        prefix,
        active: true,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      include: { tenant: { select: { id: true, name: true, active: true } } },
    });

    for (const candidate of candidates) {
      if (!candidate.tenant.active) continue;

      const match = await bcrypt.compare(rawKey, candidate.keyHash);
      if (match) {
        // Actualizar lastUsedAt sin bloquear
        void this.prisma.tenantApiKey.update({
          where: { id: candidate.id },
          data:  { lastUsedAt: new Date() },
        }).catch(() => {});

        return { id: candidate.tenant.id, name: candidate.tenant.name };
      }
    }

    return null;
  }
}
