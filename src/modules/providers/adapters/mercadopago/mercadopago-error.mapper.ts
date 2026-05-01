import { PaymentErrorCode } from '../../../../common/errors/payment-error.catalog';
import { PaymentException } from '../../../../common/errors/payment.exception';

/**
 * Mapea códigos de estado/error de MercadoPago a PaymentErrorCode interno.
 * Referencia: https://www.mercadopago.com.ar/developers/es/reference/payments/resource
 */
const STATUS_DETAIL_MAP: Record<string, PaymentErrorCode> = {
  // Rechazos de tarjeta
  cc_rejected_insufficient_amount:   PaymentErrorCode.INSUFFICIENT_FUNDS,
  cc_rejected_bad_filled_card_number:PaymentErrorCode.CARD_INVALID_NUMBER,
  cc_rejected_bad_filled_security_code: PaymentErrorCode.CARD_INVALID_CVV,
  cc_rejected_bad_filled_date:       PaymentErrorCode.CARD_INVALID_EXPIRY,
  cc_rejected_card_disabled:         PaymentErrorCode.CARD_DECLINED,
  cc_rejected_duplicated_payment:    PaymentErrorCode.DUPLICATE_TRANSACTION,
  cc_rejected_high_risk:             PaymentErrorCode.FRAUD_SUSPECTED,
  cc_rejected_max_attempts:          PaymentErrorCode.CARD_DECLINED,
  cc_rejected_other_reason:          PaymentErrorCode.CARD_DECLINED,
  cc_rejected_call_for_authorize:    PaymentErrorCode.DO_NOT_HONOR,
  cc_amount_rate_limit_exceeded:     PaymentErrorCode.EXCEEDS_LIMIT,
  // Pendientes / autorización
  pending_waiting_payment:           PaymentErrorCode.AUTHENTICATION_REQUIRED,
  pending_review_manual:             PaymentErrorCode.PROCESSING_ERROR,
  // Expirados
  expired:                           PaymentErrorCode.VOUCHER_EXPIRED,
};

export function mapMercadoPagoError(statusDetail: string, httpStatus?: number): never {
  if (httpStatus === 401 || httpStatus === 403) {
    throw new PaymentException(PaymentErrorCode.PROVIDER_UNAVAILABLE, 'Credenciales de MercadoPago inválidas');
  }
  if (httpStatus && httpStatus >= 500) {
    throw new PaymentException(PaymentErrorCode.PROVIDER_UNAVAILABLE);
  }

  const code = STATUS_DETAIL_MAP[statusDetail] ?? PaymentErrorCode.CARD_DECLINED;
  throw new PaymentException(code, statusDetail);
}
