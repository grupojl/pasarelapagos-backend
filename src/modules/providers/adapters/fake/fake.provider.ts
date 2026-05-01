import { Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  CreateChargeInput,
  PaymentProvider,
  ProviderChargeResult,
  ProviderRefundResult,
  RefundInput,
  WebhookEvent,
} from '../../provider.interface';
import { ProviderRegistry } from '../../provider.registry';

@Injectable()
export class FakeProvider implements PaymentProvider, OnModuleInit {
  private readonly logger = new Logger(FakeProvider.name);

  readonly id = 'fake';
  readonly countries = ['AR', 'BR', 'MX', 'PE', 'CL', 'CO', 'US'];
  readonly currencies = ['ARS', 'BRL', 'MXN', 'PEN', 'CLP', 'COP', 'USD', 'EUR'];

  constructor(private readonly registry: ProviderRegistry) {}

  onModuleInit() {
    if (process.env.NODE_ENV !== 'production') {
      this.registry.register(this);
      this.logger.warn('FakeProvider registrado (solo dev/test).');
    }
  }

  async createCharge(input: CreateChargeInput): Promise<ProviderChargeResult> {
    return {
      externalId: `fake_${input.idempotencyKey}`,
      status: 'captured',
      raw: { provider: 'fake', input },
    };
  }

  async refund(input: RefundInput): Promise<ProviderRefundResult> {
    return {
      externalRefundId: `fake_refund_${input.externalId}`,
      status: 'succeeded',
      raw: { provider: 'fake' },
    };
  }

  async retrieve(externalId: string): Promise<ProviderChargeResult> {
    return { externalId, status: 'captured', raw: { provider: 'fake' } };
  }

  /**
   * Verifica firma HMAC-SHA256 del webhook.
   * Header esperado: x-fake-signature: sha256=<hex>
   * Secret: WEBHOOK_SIGNING_SECRET del env.
   */
  async verifyWebhook(
    raw: Buffer,
    headers: Record<string, string>,
  ): Promise<WebhookEvent> {
    const secret = process.env.WEBHOOK_SIGNING_SECRET ?? 'change-me';
    const expected = crypto
      .createHmac('sha256', secret)
      .update(raw)
      .digest('hex');

    const sig = headers['x-fake-signature']?.replace('sha256=', '');

    // En test/dev aceptamos sin firma para facilitar testing manual
    if (process.env.NODE_ENV === 'production' && sig !== expected) {
      throw new UnauthorizedException('Firma HMAC inválida');
    }

    let body: any;
    try {
      body = JSON.parse(raw.toString());
    } catch {
      body = {};
    }

    return {
      providerId: this.id,
      eventType: body.type ?? 'payment.captured',
      externalId: body.externalId ?? `fake_ext_${Date.now()}`,
      status: body.status ?? 'captured',
      raw: body,
    };
  }
}
