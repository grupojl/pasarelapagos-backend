import { Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
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
import { mapStripeError } from './stripe-error.mapper';

// Con moduleResolution: nodenext el namespace Stripe.* no resuelve en stripe@22.
// Usamos ReturnType para tipar la instancia y strings literales para los enums.
type StripeInstance = InstanceType<typeof Stripe>;

type PaymentIntentStatus =
  | 'requires_payment_method'
  | 'requires_confirmation'
  | 'requires_action'
  | 'processing'
  | 'requires_capture'
  | 'canceled'
  | 'succeeded';

type RefundReason =
  | 'duplicate'
  | 'fraudulent'
  | 'requested_by_customer'
;

@Injectable()
export class StripeProvider implements PaymentProvider, OnModuleInit {
  private readonly logger = new Logger(StripeProvider.name);
  private stripe!: StripeInstance;
  private webhookSecret!: string;

  readonly id        = 'stripe';
  readonly countries = ['US', 'GB', 'DE', 'FR', 'ES', 'IT', 'BR', 'MX', 'AR'];
  readonly currencies = ['USD', 'EUR', 'GBP', 'BRL', 'MXN', 'ARS'];

  constructor(
    private readonly config:   ConfigService,
    private readonly registry: ProviderRegistry,
    private readonly cb:       CircuitBreakerService,
  ) {}

  onModuleInit() {
    const secretKey = this.config.get<string>('STRIPE_SECRET_KEY');
    if (!secretKey) {
      this.logger.warn('STRIPE_SECRET_KEY no configurada — StripeProvider inactivo.');
      return;
    }

    this.stripe = new Stripe(secretKey, {
      apiVersion:        '2026-03-25.dahlia',
      typescript:        true,
      maxNetworkRetries: 2,
      timeout:           10_000,
    });

    this.webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET') ?? '';
    this.registry.register(this);
    this.logger.log('StripeProvider registrado.');
  }

  async createCharge(input: CreateChargeInput): Promise<ProviderChargeResult> {
    return this.cb.execute('stripe:createCharge', async () => {
      try {
        const intent = await this.stripe.paymentIntents.create(
          {
            amount:         Number(input.amountMinor),
            currency:       input.currency.toLowerCase(),
            capture_method: 'automatic',
            description:    input.description,
            metadata:       { ...(input.metadata ?? {}), customerId: input.customer.id, country: input.country },
            receipt_email:  input.customer.email,
            ...(input.returnUrl ? {
              confirm: true,
              return_url: input.returnUrl,
              automatic_payment_methods: { enabled: true },
            } : {}),
          },
          { idempotencyKey: input.idempotencyKey },
        );

        return {
          externalId:  intent.id,
          status:      this.mapIntentStatus(intent.status as PaymentIntentStatus),
          redirectUrl: (intent.next_action as any)?.redirect_to_url?.url,
          raw:         intent,
        };
      } catch (err) {
        mapStripeError(err);
      }
    });
  }

  async capture(chargeId: string): Promise<ProviderChargeResult> {
    return this.cb.execute('stripe:capture', async () => {
      try {
        const intent = await this.stripe.paymentIntents.capture(chargeId);
        return {
          externalId: intent.id,
          status:     this.mapIntentStatus(intent.status as PaymentIntentStatus),
          raw:        intent,
        };
      } catch (err) {
        mapStripeError(err);
      }
    });
  }

  async refund(input: RefundInput): Promise<ProviderRefundResult> {
    return this.cb.execute('stripe:refund', async () => {
      try {
        const refund = await this.stripe.refunds.create({
          payment_intent: input.externalId,
          ...(input.amountMinor ? { amount: Number(input.amountMinor) } : {}),
          reason: this.mapRefundReason(input.reason),
        });
        return {
          externalRefundId: refund.id ?? '',
          status: refund.status === 'succeeded' ? 'succeeded'
                : refund.status === 'pending'   ? 'pending'
                : 'failed',
          raw: refund,
        };
      } catch (err) {
        mapStripeError(err);
      }
    });
  }

  async retrieve(externalId: string): Promise<ProviderChargeResult> {
    return this.cb.execute('stripe:retrieve', async () => {
      try {
        const intent = await this.stripe.paymentIntents.retrieve(externalId);
        return {
          externalId: intent.id,
          status:     this.mapIntentStatus(intent.status as PaymentIntentStatus),
          raw:        intent,
        };
      } catch (err) {
        mapStripeError(err);
      }
    });
  }

  async verifyWebhook(raw: Buffer, headers: Record<string, string>): Promise<WebhookEvent> {
    const sig = headers['stripe-signature'];
    if (!sig) throw new UnauthorizedException('Falta stripe-signature');

    let event: any;
    try {
      event = this.stripe.webhooks.constructEvent(raw, sig, this.webhookSecret);
    } catch (err: any) {
      throw new UnauthorizedException(`Firma Stripe inválida: ${err.message}`);
    }

    return {
      providerId: this.id,
      eventType:  event.type as string,
      externalId: this.extractExternalId(event),
      status:     this.mapEventStatus(event.type as string),
      raw:        event,
    };
  }

  // ---- helpers -------------------------------------------------------

  private mapIntentStatus(status: PaymentIntentStatus): ProviderChargeResult['status'] {
    const map: Record<PaymentIntentStatus, ProviderChargeResult['status']> = {
      requires_payment_method: 'pending',
      requires_confirmation:   'pending',
      requires_action:         'pending',
      processing:              'pending',
      requires_capture:        'authorized',
      canceled:                'cancelled',
      succeeded:               'captured',
    };
    return map[status] ?? 'pending';
  }

  private mapEventStatus(eventType: string): ProviderChargeResult['status'] {
    const map: Record<string, ProviderChargeResult['status']> = {
      'payment_intent.succeeded':                 'captured',
      'payment_intent.payment_failed':            'failed',
      'payment_intent.canceled':                  'cancelled',
      'payment_intent.amount_capturable_updated': 'authorized',
      'charge.refunded':                          'refunded',
    };
    return map[eventType] ?? 'pending';
  }

  private extractExternalId(event: any): string {
    const obj = event?.data?.object ?? {};
    return (obj.payment_intent ?? obj.id ?? 'unknown') as string;
  }

  private mapRefundReason(reason?: string): RefundReason | undefined {
    const map: Record<string, RefundReason> = {
      duplicate:             'duplicate',
      fraudulent:            'fraudulent',
      requested_by_customer: 'requested_by_customer',
    };
    return reason ? (map[reason] ?? 'requested_by_customer') : undefined;
  }
}
