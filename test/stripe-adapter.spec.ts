/**
 * Tests de contrato del adapter Stripe.
 * Mockea la librería oficial para no hacer llamadas reales.
 * Cubre: createCharge, capture, refund, retrieve, verifyWebhook, error mapping.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StripeProvider } from '../src/modules/providers/adapters/stripe/stripe.provider';
import { ProviderRegistry } from '../src/modules/providers/provider.registry';
import { CircuitBreakerService } from '../src/modules/providers/circuit-breaker.service';
import { PaymentException } from '../src/common/errors/payment.exception';
import { PaymentErrorCode } from '../src/common/errors/payment-error.catalog';
import Stripe from 'stripe';

// Mock de la librería stripe
jest.mock('stripe');

const mockCreate   = jest.fn();
const mockCapture  = jest.fn();
const mockRetrieve = jest.fn();
const mockRefund   = jest.fn();
const mockWebhook  = jest.fn();

(Stripe as jest.MockedClass<typeof Stripe>).mockImplementation(() => ({
  paymentIntents: { create: mockCreate, capture: mockCapture, retrieve: mockRetrieve },
  refunds:        { create: mockRefund },
  webhooks:       { constructEvent: mockWebhook },
} as any));

describe('StripeProvider (contrato)', () => {
  let provider: StripeProvider;
  let registry: ProviderRegistry;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeProvider,
        CircuitBreakerService,
        {
          provide: ProviderRegistry,
          useValue: { register: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: {
            get:          (k: string) => k === 'STRIPE_SECRET_KEY' ? 'sk_test_fake' : undefined,
            getOrThrow:   (k: string) => k === 'STRIPE_WEBHOOK_SECRET' ? 'whsec_fake' : 'sk_test_fake',
          },
        },
      ],
    }).compile();

    provider = module.get(StripeProvider);
    registry = module.get(ProviderRegistry);
    provider.onModuleInit();
  });

  afterEach(() => jest.clearAllMocks());

  // -----------------------------------------------------------------------
  describe('createCharge', () => {
    it('retorna externalId y status captured en pago exitoso', async () => {
      mockCreate.mockResolvedValue({
        id: 'pi_test_123',
        status: 'succeeded',
        next_action: null,
      });

      const result = await provider.createCharge({
        amountMinor: 10000n,
        currency: 'USD',
        country: 'US',
        customer: { id: 'cust_1', email: 'x@test.com' },
        method: 'card',
        idempotencyKey: 'key-001',
      });

      expect(result.externalId).toBe('pi_test_123');
      expect(result.status).toBe('captured');
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('retorna redirectUrl cuando Stripe pide 3DS', async () => {
      mockCreate.mockResolvedValue({
        id: 'pi_3ds_123',
        status: 'requires_action',
        next_action: {
          redirect_to_url: { url: 'https://stripe.com/3ds' },
        },
      });

      const result = await provider.createCharge({
        amountMinor: 5000n,
        currency: 'EUR',
        country: 'DE',
        customer: { id: 'cust_2' },
        method: 'card',
        idempotencyKey: 'key-3ds',
        returnUrl: 'https://app.com/return',
      });

      expect(result.status).toBe('pending');
      expect(result.redirectUrl).toBe('https://stripe.com/3ds');
    });

    it('mapea insufficient_funds → PaymentException INSUFFICIENT_FUNDS', async () => {
      const stripeErr = new Stripe.errors.StripeCardError({
        type: 'card_error',
        code: 'insufficient_funds',
        message: 'No funds',
        doc_url: '',
        param: '',
      } as any);
      mockCreate.mockRejectedValue(stripeErr);

      await expect(
        provider.createCharge({
          amountMinor: 999999n,
          currency: 'USD',
          country: 'US',
          customer: { id: 'cust_3' },
          method: 'card',
          idempotencyKey: 'key-nsf',
        }),
      ).rejects.toBeInstanceOf(PaymentException);

      try {
        await provider.createCharge({
          amountMinor: 999999n,
          currency: 'USD',
          country: 'US',
          customer: { id: 'cust_3' },
          method: 'card',
          idempotencyKey: 'key-nsf-2',
        });
      } catch (e: any) {
        expect(e.code).toBe(PaymentErrorCode.INSUFFICIENT_FUNDS);
        expect(e.retryable).toBe(false);
      }
    });

    it('mapea StripeConnectionError → PROVIDER_UNAVAILABLE (retryable)', async () => {
      mockCreate.mockRejectedValue(
        new Stripe.errors.StripeConnectionError({ message: 'ECONNREFUSED', type: 'api_connection_error' } as any),
      );

      try {
        await provider.createCharge({
          amountMinor: 100n,
          currency: 'USD',
          country: 'US',
          customer: { id: 'c' },
          method: 'card',
          idempotencyKey: 'key-conn',
        });
      } catch (e: any) {
        expect(e.code).toBe(PaymentErrorCode.PROVIDER_UNAVAILABLE);
        expect(e.retryable).toBe(true);
      }
    });
  });

  // -----------------------------------------------------------------------
  describe('refund', () => {
    it('retorna externalRefundId y status succeeded', async () => {
      mockRefund.mockResolvedValue({ id: 're_123', status: 'succeeded' });

      const result = await provider.refund({
        externalId: 'pi_test_123',
        amountMinor: 5000n,
      });

      expect(result.externalRefundId).toBe('re_123');
      expect(result.status).toBe('succeeded');
    });
  });

  // -----------------------------------------------------------------------
  describe('retrieve', () => {
    it('retorna el estado actual del PaymentIntent', async () => {
      mockRetrieve.mockResolvedValue({ id: 'pi_test_123', status: 'succeeded' });
      const result = await provider.retrieve('pi_test_123');
      expect(result.status).toBe('captured');
    });
  });

  // -----------------------------------------------------------------------
  describe('verifyWebhook', () => {
    it('retorna WebhookEvent para payment_intent.succeeded', async () => {
      mockWebhook.mockReturnValue({
        id: 'evt_123',
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_abc', payment_intent: 'pi_abc' } },
      });

      const event = await provider.verifyWebhook(
        Buffer.from('{}'),
        { 'stripe-signature': 't=123,v1=abc' },
      );

      expect(event.eventType).toBe('payment_intent.succeeded');
      expect(event.status).toBe('captured');
    });

    it('lanza UnauthorizedException si la firma es inválida', async () => {
      mockWebhook.mockImplementation(() => {
        throw new Error('Signature mismatch');
      });

      await expect(
        provider.verifyWebhook(Buffer.from('{}'), { 'stripe-signature': 'bad' }),
      ).rejects.toThrow('Firma Stripe inválida');
    });
  });

  // -----------------------------------------------------------------------
  describe('registro', () => {
    it('se registra en el ProviderRegistry al inicializar', () => {
      expect(registry.register).toHaveBeenCalledWith(provider);
    });

    it('tiene los metadatos correctos', () => {
      expect(provider.id).toBe('stripe');
      expect(provider.currencies).toContain('USD');
      expect(provider.countries).toContain('US');
    });
  });
});
