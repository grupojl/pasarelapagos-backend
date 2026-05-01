import { PaymentErrorCode } from '../../../../common/errors/payment-error.catalog';
import { PaymentException } from '../../../../common/errors/payment.exception';

/**
 * Referencia: https://docs.pagar.me/reference/erros-da-api
 */
const CODE_MAP: Record<string, PaymentErrorCode> = {
  'action_forbidden':            PaymentErrorCode.CARD_DECLINED,
  'card_declined':               PaymentErrorCode.CARD_DECLINED,
  'insufficient_funds':          PaymentErrorCode.INSUFFICIENT_FUNDS,
  'expired_card':                PaymentErrorCode.CARD_EXPIRED,
  'invalid_card_number':         PaymentErrorCode.CARD_INVALID_NUMBER,
  'invalid_cvv':                 PaymentErrorCode.CARD_INVALID_CVV,
  'invalid_expiration_date':     PaymentErrorCode.CARD_INVALID_EXPIRY,
  'fraud_suspected':             PaymentErrorCode.FRAUD_SUSPECTED,
  'processing_error':            PaymentErrorCode.PROCESSING_ERROR,
  'pix_key_not_found':           PaymentErrorCode.PIX_KEY_NOT_FOUND,
  'invalid_document':            PaymentErrorCode.DOCUMENT_INVALID,
};

export function mapPagarmeError(error: any): never {
  if (error?.response?.status >= 500) {
    throw new PaymentException(PaymentErrorCode.PROVIDER_UNAVAILABLE);
  }

  const errors: any[] = error?.response?.data?.errors ?? [];
  const firstCode = errors[0]?.code ?? '';
  const internalCode = CODE_MAP[firstCode] ?? PaymentErrorCode.PROVIDER_UNKNOWN;
  throw new PaymentException(internalCode, errors[0]?.message);
}
