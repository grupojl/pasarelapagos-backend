import { Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
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
import { CircuitBreakerService } from '../../circuit-breaker.service';
import { mapConektaError } from './conekta-error.mapper';

/**
 * Adapter Conekta v2 (México).
 * Soporta: tarjeta de crédito/débito + OXXO Pay (cash voucher).
 * Docs: https://developers.conekta.com/reference/introduccion
 */
@Injectable()
export class ConektaProvider implements PaymentProvider, OnModuleInit {
  private readonly logger = new Logger(ConektaProvider.name);
  private http!: AxiosInstance;
  private webhookSecret!: string;

  readonly id = 'conekta';
  readonly countries = ['MX'];
  readonly currencies = ['MXN'];

  constructor(
    private readonly config: ConfigService,
    private readonly registry: ProviderRegistry,
    private readonly cb: CircuitBreakerService,
  ) {}

  onModuleInit() {
    const apiKey = this.config.get<string>('CONEKTA_PRIVATE_KEY');
    if (!apiKey) {
      this.logger.warn('CONEKTA_PRIVATE_KEY no configurada — ConektaProvider inactivo.');
      return;
    }

    this.http = axios.create({
      baseURL: 'https://api.conekta.io',
      timeout: 10_000,
      headers: {
        'Accept':          'application/vnd.conekta-v2.2.0+json',
        'Content-Type':    'application/json',
        'Authorization':   `Bearer ${apiKey}`,
        'Accept-Language': 'es',
      },
    });

    this.webhookSecret = this.config.get<string>('CONEKTA_WEBHOOK_SECRET') ?? '';
    this.registry.register(this);
    this.logger.log('ConektaProvider registrado.');
  }

  // -----------------------------------------------------------------------
  // createCharge
  // -----------------------------------------------------------------------
  async createCharge(input: CreateChargeInput): Promise<ProviderChargeResult> {
    return this.cb.execute(`conekta:createCharge`, async () => {
      try {
        const isOxxo = input.method === 'cash_voucher';

        const body: any = {
          currency:    'MXN',
          customer_info: {
            name:  input.customer.id,
            email: input.customer.email ?? 'pagador@example.com',
            phone: '+5200000000000',
          },
          line_items: [{
            name:       input.description ?? 'Producto',
            unit_price: Number(input.amountMinor),
            quantity:   1,
          }],
          charges: [{
            payment_method: isOxxo
              ? {
                  type:       'cash',
                  expires_at: Math.floor(Date.now() / 1000) + 3 * 24 * 3600, // 3 días
                }
              : {
                  type:         'card',
                  payment_source_id: input.metadata?.paymentSourceId ?? '', // token de tarjeta
                },
          }],
          metadata: { ...input.metadata, idempotencyKey: input.idempotencyKey },
        };

        const { data } = await this.http.post('/orders', body);
        const charge   = data.charges?.data?.[0];

        return {
          externalId:  charge?.id ?? data.id,
          status:      this.mapStatus(charge?.status ?? data.payment_status),
          redirectUrl: charge?.payment_method?.reference ?? undefined,
          raw:         data,
        };
      } catch (err) {
        mapConektaError(err);
      }
    });
  }

  // -----------------------------------------------------------------------
  // refund
  // -----------------------------------------------------------------------
  async refund(input: RefundInput): Promise<ProviderRefundResult> {
    return this.cb.execute(`conekta:refund`, async () => {
      try {
        // Conekta requiere orderId para refund — el externalId es el charge id
        const body: any = { reason: input.reason ?? 'requested_by_client' };
        if (input.amountMinor) body.amount = Number(input.amountMinor);

        const { data } = await this.http.post(
          `/orders/${input.externalId}/refunds`,
          body,
        );

        return {
          externalRefundId: data.id,
          status:           'succeeded',
          raw:              data,
        };
      } catch (err) {
        mapConektaError(err);
      }
    });
  }

  // -----------------------------------------------------------------------
  // retrieve
  // -----------------------------------------------------------------------
  async retrieve(externalId: string): Promise<ProviderChargeResult> {
    return this.cb.execute(`conekta:retrieve`, async () => {
      try {
        const { data } = await this.http.get(`/orders/${externalId}`);
        return {
          externalId: data.id,
          status:     this.mapStatus(data.payment_status),
          raw:        data,
        };
      } catch (err) {
        mapConektaError(err);
      }
    });
  }

  // -----------------------------------------------------------------------
  // verifyWebhook
  // -----------------------------------------------------------------------
  async verifyWebhook(
    raw: Buffer,
    headers: Record<string, string>,
  ): Promise<WebhookEvent> {
    if (this.webhookSecret) {
      const digest   = crypto.createHmac('sha256', this.webhookSecret).update(raw).digest('hex');
      const incoming = headers['digest']?.replace('sha256=', '') ?? '';
      if (incoming && digest !== incoming) {
        throw new UnauthorizedException('Firma Conekta inválida');
      }
    }

    let body: any;
    try { body = JSON.parse(raw.toString()); } catch { body = {}; }

    const order   = body.data?.object ?? {};
    const charges = order.charges?.data ?? [];
    const charge  = charges[charges.length - 1] ?? {};

    return {
      providerId: this.id,
      eventType:  body.type ?? 'order.updated',
      externalId: charge.id ?? order.id ?? 'unknown',
      status:     this.mapStatus(charge.status ?? order.payment_status ?? 'pending'),
      raw:        body,
    };
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------
  private mapStatus(s: string): ProviderChargeResult['status'] {
    const map: Record<string, ProviderChargeResult['status']> = {
      paid:            'captured',
      partially_paid:  'authorized',
      pending_payment: 'pending',
      expired:         'failed',
      declined:        'failed',
      refunded:        'refunded',
      voided:          'cancelled',
    };
    return map[s] ?? 'pending';
  }
}
