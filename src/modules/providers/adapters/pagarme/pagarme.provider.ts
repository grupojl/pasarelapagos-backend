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
import { mapPagarmeError } from './pagarme-error.mapper';

/**
 * Adapter Pagar.me v5 (Brasil).
 * Soporta: card (crédito/débito) + PIX nativo.
 * Docs: https://docs.pagar.me/reference/introducao
 */
@Injectable()
export class PagarmeProvider implements PaymentProvider, OnModuleInit {
  private readonly logger = new Logger(PagarmeProvider.name);
  private http!: AxiosInstance;
  private webhookSecret!: string;

  readonly id = 'pagarme';
  readonly countries = ['BR'];
  readonly currencies = ['BRL'];

  constructor(
    private readonly config: ConfigService,
    private readonly registry: ProviderRegistry,
    private readonly cb: CircuitBreakerService,
  ) {}

  onModuleInit() {
    const apiKey = this.config.get<string>('PAGARME_API_KEY');
    if (!apiKey) {
      this.logger.warn('PAGARME_API_KEY no configurada — PagarmeProvider inactivo.');
      return;
    }

    this.http = axios.create({
      baseURL: 'https://api.pagar.me/core/v5',
      timeout: 10_000,
      // Pagar.me usa Basic Auth: base64(apiKey:)
      auth: { username: apiKey, password: '' },
      headers: { 'Content-Type': 'application/json' },
    });

    this.webhookSecret = this.config.get<string>('PAGARME_WEBHOOK_SECRET') ?? '';
    this.registry.register(this);
    this.logger.log('PagarmeProvider registrado.');
  }

  // -----------------------------------------------------------------------
  // createCharge
  // -----------------------------------------------------------------------
  async createCharge(input: CreateChargeInput): Promise<ProviderChargeResult> {
    return this.cb.execute(`pagarme:createCharge`, async () => {
      try {
        const isPix = input.method === 'pix';

        const body: any = {
          items: [{
            amount:   Number(input.amountMinor),
            description: input.description ?? 'Produto',
            quantity: 1,
            code:     'ITEM_001',
          }],
          customer: {
            name:  input.customer.id,
            email: input.customer.email ?? 'pagador@example.com',
            type:  'individual',
            document:       input.customer.documentId ?? '00000000000',
            document_type:  'CPF',
          },
          payments: [
            isPix
              ? {
                  payment_method: 'pix',
                  pix: {
                    expires_in: 3600, // 1 hora
                    additional_information: [
                      { name: 'order', value: input.idempotencyKey },
                    ],
                  },
                }
              : {
                  payment_method: 'credit_card',
                  credit_card: {
                    recurrence: false,
                    installments: 1,
                    statement_descriptor: 'PASARELA',
                  },
                },
          ],
          code: input.idempotencyKey,
        };

        const { data } = await this.http.post('/orders', body);
        const charge   = data.charges?.[0];
        const lastTx   = charge?.last_transaction;

        const pixQr = lastTx?.qr_code_url ?? lastTx?.qr_code ?? undefined;

        return {
          externalId:  charge?.id ?? data.id,
          status:      this.mapStatus(charge?.status ?? data.status),
          redirectUrl: pixQr,
          raw:         data,
        };
      } catch (err) {
        mapPagarmeError(err);
      }
    });
  }

  // -----------------------------------------------------------------------
  // refund
  // -----------------------------------------------------------------------
  async refund(input: RefundInput): Promise<ProviderRefundResult> {
    return this.cb.execute(`pagarme:refund`, async () => {
      try {
        const body: any = {};
        if (input.amountMinor) body.amount = Number(input.amountMinor);

        const { data } = await this.http.post(
          `/charges/${input.externalId}/cancel`,
          body,
        );

        return {
          externalRefundId: data.id,
          status:           data.status === 'canceled' ? 'succeeded' : 'pending',
          raw:              data,
        };
      } catch (err) {
        mapPagarmeError(err);
      }
    });
  }

  // -----------------------------------------------------------------------
  // retrieve
  // -----------------------------------------------------------------------
  async retrieve(externalId: string): Promise<ProviderChargeResult> {
    return this.cb.execute(`pagarme:retrieve`, async () => {
      try {
        const { data } = await this.http.get(`/charges/${externalId}`);
        return {
          externalId: data.id,
          status:     this.mapStatus(data.status),
          raw:        data,
        };
      } catch (err) {
        mapPagarmeError(err);
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
      const sig      = headers['x-hub-signature'] ?? '';
      const expected = 'sha1=' + crypto
        .createHmac('sha1', this.webhookSecret)
        .update(raw)
        .digest('hex');

      if (sig !== expected) {
        throw new UnauthorizedException('Firma Pagar.me inválida');
      }
    }

    let body: any;
    try { body = JSON.parse(raw.toString()); } catch { body = {}; }

    const charge = body.data?.charges?.[0] ?? body.data ?? {};

    return {
      providerId: this.id,
      eventType:  body.type ?? 'charge.updated',
      externalId: charge.id ?? body.id ?? 'unknown',
      status:     this.mapStatus(charge.status ?? body.data?.status ?? 'pending'),
      raw:        body,
    };
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------
  private mapStatus(s: string): ProviderChargeResult['status'] {
    const map: Record<string, ProviderChargeResult['status']> = {
      paid:        'captured',
      authorized:  'authorized',
      pending:     'pending',
      waiting_payment: 'pending',
      processing:  'pending',
      failed:      'failed',
      canceled:    'cancelled',
      refunded:    'refunded',
      chargedback: 'refunded',
      // PIX específico
      generated:   'pending',
      waiting:     'pending',
    };
    return map[s] ?? 'pending';
  }
}
