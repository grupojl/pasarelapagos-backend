import { PaymentErrorCode } from '../../../../common/errors/payment-error.catalog';
import { PaymentException } from '../../../../common/errors/payment.exception';

/**
 * Referencia: https://developers.conekta.com/reference/errors
 */
const CODE_MAP: Record<string, PaymentErrorCode> = {
  'conekta.errors.processing.bank.insufficient_funds':  PaymentErrorCode.INSUFFICIENT_FUNDS,
  'conekta.errors.processing.bank.card_declined':       PaymentErrorCode.CARD_DECLINED,
  'conekta.errors.processing.bank.expired_card':        PaymentErrorCode.CARD_EXPIRED,
  'conekta.errors.processing.bank.invalid_card':        PaymentErrorCode.CARD_INVALID_NUMBER,
  'conekta.errors.processing.bank.suspected_fraud':     PaymentErrorCode.FRAUD_SUSPECTED,
  'conekta.errors.processing.charge.card_declined':     PaymentErrorCode.CARD_DECLINED,
  'conekta.errors.processing.order.expired':            PaymentErrorCode.VOUCHER_EXPIRED,
  'conekta.errors.request.validation.required':         PaymentErrorCode.PROVIDER_UNKNOWN,
};

export function mapConektaError(error: any): never {
  if (error?.response?.status >= 500) {
    throw new PaymentException(PaymentErrorCode.PROVIDER_UNAVAILABLE);
  }
  const details: any[] = error?.response?.data?.details ?? [];
  const firstCode = details[0]?.code ?? error?.response?.data?.code ?? '';
  const internalCode = CODE_MAP[firstCode] ?? PaymentErrorCode.PROVIDER_UNKNOWN;
  throw new PaymentException(internalCode, details[0]?.message ?? error?.message);
}
