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
import { mapDlocalError } from './dlocal-error.mapper';

/**
 * Adapter dLocal — agregador LATAM.
 * Cubre: PE (Perú), CL (Chile), CO (Colombia), UY (Uruguay) + más.
 * Auth: HMAC-SHA256 con apiKey + secretKey.
 * Docs: https://docs.dlocal.com
 */
@Injectable()
export class DlocalProvider implements PaymentProvider, OnModuleInit {
  private readonly logger = new Logger(DlocalProvider.name);
  private http!: AxiosInstance;
  private apiKey!: string;
  private secretKey!: string;

  readonly id = 'dlocal';
  readonly countries = ['PE', 'CL', 'CO', 'UY', 'BO', 'PY', 'CR', 'GT', 'EC'];
  readonly currencies = ['PEN', 'CLP', 'COP', 'UYU', 'BOB', 'PYG', 'CRC', 'GTQ', 'USD'];

  constructor(
    private readonly config: ConfigService,
    private readonly registry: ProviderRegistry,
    private readonly cb: CircuitBreakerService,
  ) {}

  onModuleInit() {
    this.apiKey    = this.config.get<string>('DLOCAL_API_KEY')    ?? '';
    this.secretKey = this.config.get<string>('DLOCAL_SECRET_KEY') ?? '';

    if (!this.apiKey || !this.secretKey) {
      this.logger.warn('DLOCAL_API_KEY / DLOCAL_SECRET_KEY no configuradas — dLocalProvider inactivo.');
      return;
    }

    this.http = axios.create({
      baseURL: 'https://sandbox.dlocal.com', // prod: https://api.dlocal.com
      timeout: 12_000,
      headers: { 'Content-Type': 'application/json' },
    });

    // Interceptor: agrega la firma HMAC en cada request
    this.http.interceptors.request.use((cfg) => {
      const ts        = Date.now().toString();
      const body      = cfg.data ? JSON.stringify(cfg.data) : '';
      const toSign    = this.apiKey + ts + body;
      const signature = crypto
        .createHmac('sha256', this.secretKey)
        .update(toSign)
        .digest('hex');

      cfg.headers = cfg.headers ?? {};
      cfg.headers['X-Date']      = ts;
      cfg.headers['X-Login']     = this.apiKey;
      cfg.headers['X-Trans-Key'] = this.secretKey;
      cfg.headers['Authorization'] = `V2-HMAC-SHA256, Signature: ${signature}`;
      return cfg;
    });

    this.registry.register(this);
    this.logger.log('dLocalProvider registrado.');
  }

  // -----------------------------------------------------------------------
  // createCharge
  // -----------------------------------------------------------------------
  async createCharge(input: CreateChargeInput): Promise<ProviderChargeResult> {
    return this.cb.execute(`dlocal:createCharge`, async () => {
      try {
        const body = {
          amount:    Number(input.amountMinor) / 100,
          currency:  input.currency,
          country:   input.country,
          payment_method_id: this.mapMethod(input.method, input.country),
          payment_method_flow: 'REDIRECT',
          payer: {
            name:     input.customer.id,
            email:    input.customer.email ?? 'pagador@example.com',
            document: input.customer.documentId ?? '12345678',
          },
          order_id:       input.idempotencyKey,
          description:    input.description ?? 'Pago',
          callback_url:   input.returnUrl ?? 'https://example.com/callback',
          notification_url: input.returnUrl ?? 'https://example.com/notify',
        };

        const { data } = await this.http.post('/secure_payments', body);

        return {
          externalId:  data.id,
          status:      this.mapStatus(data.status),
          redirectUrl: data.redirect_url,
          raw:         data,
        };
      } catch (err) {
        mapDlocalError(err);
      }
    });
  }

  // -----------------------------------------------------------------------
  // refund
  // -----------------------------------------------------------------------
  async refund(input: RefundInput): Promise<ProviderRefundResult> {
    return this.cb.execute(`dlocal:refund`, async () => {
      try {
        const body: any = {
          payment_id: input.externalId,
          notification_url: 'https://example.com/notify',
        };
        if (input.amountMinor) body.amount = Number(input.amountMinor) / 100;

        const { data } = await this.http.post('/refunds', body);

        return {
          externalRefundId: data.id,
          status:           this.mapRefundStatus(data.status),
          raw:              data,
        };
      } catch (err) {
        mapDlocalError(err);
      }
    });
  }

  // -----------------------------------------------------------------------
  // retrieve
  // -----------------------------------------------------------------------
  async retrieve(externalId: string): Promise<ProviderChargeResult> {
    return this.cb.execute(`dlocal:retrieve`, async () => {
      try {
        const { data } = await this.http.get(`/payments/${externalId}`);
        return {
          externalId: data.id,
          status:     this.mapStatus(data.status),
          raw:        data,
        };
      } catch (err) {
        mapDlocalError(err);
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
    const sig      = headers['x-dlocal-signature'] ?? '';
    const expected = crypto
      .createHmac('sha256', this.secretKey)
      .update(raw)
      .digest('hex');

    if (sig && sig !== expected) {
      throw new UnauthorizedException('Firma dLocal inválida');
    }

    let body: any;
    try { body = JSON.parse(raw.toString()); } catch { body = {}; }

    return {
      providerId: this.id,
      eventType:  body.event_type ?? 'PAYMENT',
      externalId: body.data?.id ?? 'unknown',
      status:     this.mapStatus(body.data?.status ?? 'PENDING'),
      raw:        body,
    };
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------
  private mapStatus(s: string): ProviderChargeResult['status'] {
    const map: Record<string, ProviderChargeResult['status']> = {
      PAID:       'captured',
      AUTHORIZED: 'authorized',
      PENDING:    'pending',
      PROCESSING: 'pending',
      REJECTED:   'failed',
      CANCELLED:  'cancelled',
      EXPIRED:    'failed',
      REFUNDED:   'refunded',
    };
    return map[s?.toUpperCase()] ?? 'pending';
  }

  private mapRefundStatus(s: string): ProviderRefundResult['status'] {
    if (s === 'SUCCESS') return 'succeeded';
    if (s === 'PENDING') return 'pending';
    return 'failed';
  }

  private mapMethod(method: string, country: string): string {
    // dLocal usa códigos específicos por país
    const COUNTRY_METHODS: Record<string, Record<string, string>> = {
      PE: { card: 'VI', bank_transfer: 'BT', cash_voucher: 'PEC', wallet: 'YPE' },
      CL: { card: 'VI', bank_transfer: 'WP', cash_voucher: 'EF' },
      CO: { card: 'VI', bank_transfer: 'DA', cash_voucher: 'EF' },
      UY: { card: 'VI', bank_transfer: 'RE', cash_voucher: 'OC' },
    };
    return COUNTRY_METHODS[country]?.[method] ?? 'VI';
  }
}
