import {
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MercadoPagoConfig, Payment, PaymentRefund } from 'mercadopago';
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
import { mapMercadoPagoError } from './mercadopago-error.mapper';

@Injectable()
export class MercadoPagoProvider implements PaymentProvider, OnModuleInit {
  private readonly logger = new Logger(MercadoPagoProvider.name);
  private paymentClient!: Payment;
  private refundClient!: PaymentRefund;

  readonly id = 'mercadopago';
  readonly countries = ['AR', 'BR', 'MX', 'CO', 'CL', 'PE', 'UY', 'BO', 'PY'];
  readonly currencies = ['ARS', 'BRL', 'MXN', 'COP', 'CLP', 'PEN', 'UYU', 'BOB', 'PYG'];

  constructor(
    private readonly config: ConfigService,
    private readonly registry: ProviderRegistry,
    private readonly cb: CircuitBreakerService,
  ) {}

  onModuleInit() {
    const accessToken = this.config.get<string>('MERCADOPAGO_ACCESS_TOKEN');
    if (!accessToken) {
      this.logger.warn('MERCADOPAGO_ACCESS_TOKEN no configurado — MercadoPagoProvider inactivo.');
      return;
    }

    const mpConfig = new MercadoPagoConfig({
      accessToken,
      options: { timeout: 10_000, idempotencyKey: '' },
    });

    this.paymentClient = new Payment(mpConfig);
    this.refundClient  = new PaymentRefund(mpConfig);

    this.registry.register(this);
    this.logger.log('MercadoPagoProvider registrado.');
  }

  // -----------------------------------------------------------------------
  // createCharge
  // -----------------------------------------------------------------------
  async createCharge(input: CreateChargeInput): Promise<ProviderChargeResult> {
    return this.cb.execute(`mp:createCharge`, async () => {
      try {
        const body: any = {
          transaction_amount: Number(input.amountMinor) / 100, // MP usa pesos enteros o float
          description:        input.description ?? 'Pago',
          payment_method_id:  this.mapMethod(input.method),
          payer: {
            email:        input.customer.email ?? 'pagador@example.com',
            identification: input.customer.documentId
              ? { type: 'DNI', number: input.customer.documentId }
              : undefined,
          },
          metadata: { ...input.metadata, customerId: input.customer.id },
          statement_descriptor: 'PASARELA',
          ...(input.returnUrl ? { callback_url: input.returnUrl } : {}),
        };

        // PIX: datos específicos Brasil
        if (input.method === 'pix') {
          body.payment_method_id = 'pix';
          body.date_of_expiration = new Date(
            Date.now() + 24 * 60 * 60 * 1000,
          ).toISOString();
        }

        const result = await this.paymentClient.create({
          body,
          requestOptions: { idempotencyKey: input.idempotencyKey },
        });

        if (result.status === 'rejected') {
          mapMercadoPagoError(result.status_detail ?? 'cc_rejected_other_reason');
        }

        return {
          externalId:  String(result.id),
          status:      this.mapStatus(result.status ?? 'pending'),
          redirectUrl: result.point_of_interaction?.transaction_data?.ticket_url ?? undefined,
          raw:         result,
        };
      } catch (err: any) {
        if (err?.cause?.[0]?.code) {
          mapMercadoPagoError(err.cause[0].code, err.status);
        }
        throw err;
      }
    });
  }

  // -----------------------------------------------------------------------
  // refund
  // -----------------------------------------------------------------------
  async refund(input: RefundInput): Promise<ProviderRefundResult> {
    return this.cb.execute(`mp:refund`, async () => {
      const result = await this.refundClient.create({
        payment_id: Number(input.externalId),
        body: input.amountMinor
          ? { amount: Number(input.amountMinor) / 100 }
          : {},
      });

      return {
        externalRefundId: String(result.id),
        status:           result.status === 'approved' ? 'succeeded' : 'pending',
        raw:              result,
      };
    });
  }

  // -----------------------------------------------------------------------
  // retrieve
  // -----------------------------------------------------------------------
  async retrieve(externalId: string): Promise<ProviderChargeResult> {
    return this.cb.execute(`mp:retrieve`, async () => {
      const result = await this.paymentClient.get({ id: Number(externalId) });
      return {
        externalId: String(result.id),
        status:     this.mapStatus(result.status ?? 'pending'),
        raw:        result,
      };
    });
  }

  // -----------------------------------------------------------------------
  // verifyWebhook
  // -----------------------------------------------------------------------
  async verifyWebhook(
    raw: Buffer,
    headers: Record<string, string>,
  ): Promise<WebhookEvent> {
    const secret    = this.config.get<string>('MERCADOPAGO_WEBHOOK_SECRET') ?? '';
    const xSig      = headers['x-signature'] ?? '';
    const xReqId    = headers['x-request-id'] ?? '';
    const dataId    = this.extractDataId(raw);

    // Verificación HMAC (si secret está configurado)
    if (secret) {
      const signedTemplate = `id:${dataId};request-id:${xReqId};ts:${xSig.split(',').find(p => p.startsWith('ts='))?.split('=')[1] ?? ''};`;
      const hash = crypto.createHmac('sha256', secret).update(signedTemplate).digest('hex');
      const v1   = xSig.split(',').find(p => p.startsWith('v1='))?.split('=')[1] ?? '';
      if (v1 && hash !== v1) {
        throw new UnauthorizedException('Firma MercadoPago inválida');
      }
    }

    let body: any;
    try { body = JSON.parse(raw.toString()); } catch { body = {}; }

    const mpStatus = body.data?.status ?? body.action?.replace('payment.', '') ?? 'pending';

    return {
      providerId: this.id,
      eventType:  body.action ?? body.type ?? 'payment.updated',
      externalId: String(body.data?.id ?? dataId),
      status:     this.mapStatus(mpStatus),
      raw:        body,
    };
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------
  private mapStatus(s: string): ProviderChargeResult['status'] {
    const map: Record<string, ProviderChargeResult['status']> = {
      approved:    'captured',
      authorized:  'authorized',
      in_process:  'pending',
      in_mediation:'pending',
      pending:     'pending',
      rejected:    'failed',
      cancelled:   'cancelled',
      refunded:    'refunded',
      charged_back:'refunded',
      // PIX / boleto
      opened:      'pending',
      waiting_transfer: 'pending',
    };
    return map[s] ?? 'pending';
  }

  private mapMethod(method: string): string {
    const map: Record<string, string> = {
      card:          'credit_card',
      wallet:        'account_money',
      bank_transfer: 'bank_transfer',
      pix:           'pix',
      qr:            'account_money',
    };
    return map[method] ?? 'credit_card';
  }

  private extractDataId(raw: Buffer): string {
    try {
      const body = JSON.parse(raw.toString());
      return String(body.data?.id ?? body.id ?? Date.now());
    } catch {
      return String(Date.now());
    }
  }
}
