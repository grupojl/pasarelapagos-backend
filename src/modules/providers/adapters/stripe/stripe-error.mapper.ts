import Stripe from 'stripe';
import { PaymentErrorCode } from '../../../../common/errors/payment-error.catalog';
import { PaymentException } from '../../../../common/errors/payment.exception';

const CARD_CODE_MAP: Record<string, PaymentErrorCode> = {
  insufficient_funds:         PaymentErrorCode.INSUFFICIENT_FUNDS,
  card_declined:              PaymentErrorCode.CARD_DECLINED,
  expired_card:               PaymentErrorCode.CARD_EXPIRED,
  incorrect_number:           PaymentErrorCode.CARD_INVALID_NUMBER,
  invalid_number:             PaymentErrorCode.CARD_INVALID_NUMBER,
  incorrect_cvc:              PaymentErrorCode.CARD_INVALID_CVV,
  invalid_cvc:                PaymentErrorCode.CARD_INVALID_CVV,
  invalid_expiry_month:       PaymentErrorCode.CARD_INVALID_EXPIRY,
  invalid_expiry_year:        PaymentErrorCode.CARD_INVALID_EXPIRY,
  card_not_supported:         PaymentErrorCode.CARD_NOT_SUPPORTED,
  do_not_honor:               PaymentErrorCode.DO_NOT_HONOR,
  lost_card:                  PaymentErrorCode.LOST_CARD,
  stolen_card:                PaymentErrorCode.STOLEN_CARD,
  fraudulent:                 PaymentErrorCode.FRAUD_SUSPECTED,
  pickup_card:                PaymentErrorCode.FRAUD_SUSPECTED,
  transaction_not_allowed:    PaymentErrorCode.CARD_NOT_SUPPORTED,
  duplicate_transaction:      PaymentErrorCode.DUPLICATE_TRANSACTION,
  currency_not_supported:     PaymentErrorCode.CURRENCY_NOT_SUPPORTED,
  amount_too_small:           PaymentErrorCode.AMOUNT_TOO_SMALL,
  amount_too_large:           PaymentErrorCode.AMOUNT_TOO_LARGE,
  authentication_required:    PaymentErrorCode.AUTHENTICATION_REQUIRED,
  payment_intent_authentication_failure: PaymentErrorCode.AUTHENTICATION_FAILED,
};

export function mapStripeError(err: unknown): never {
  // Error de tarjeta — usar instanceof con la clase concreta
  if (err instanceof Stripe.errors.StripeCardError) {
    const code = (err as InstanceType<typeof Stripe.errors.StripeCardError>).code ?? '';
    const mapped = CARD_CODE_MAP[code];
    throw new PaymentException(
      mapped ?? PaymentErrorCode.CARD_DECLINED,
      err.message,
    );
  }

  // Timeout / conexión — StripeTimeoutError fue eliminado; ambos casos
  // se manejan como StripeConnectionError en Stripe v17+
  if (err instanceof Stripe.errors.StripeConnectionError) {
    throw new PaymentException(PaymentErrorCode.PROVIDER_UNAVAILABLE, (err as Error).message);
  }

  // API no disponible (5xx de Stripe)
  if (err instanceof Stripe.errors.StripeAPIError) {
    throw new PaymentException(PaymentErrorCode.PROVIDER_UNAVAILABLE, (err as Error).message);
  }

  // Rate limit
  if (err instanceof Stripe.errors.StripeRateLimitError) {
    throw new PaymentException(PaymentErrorCode.PROVIDER_UNAVAILABLE, 'Stripe rate limit');
  }

  // Autenticación / permisos
  if (err instanceof Stripe.errors.StripeAuthenticationError) {
    throw new PaymentException(PaymentErrorCode.PROVIDER_UNKNOWN, 'Stripe authentication error');
  }

  // Fallback
  const message = err instanceof Error ? err.message : String(err);
  throw new PaymentException(PaymentErrorCode.PROVIDER_UNKNOWN, message);
}
