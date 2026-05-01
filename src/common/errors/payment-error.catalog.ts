/**
 * Catálogo centralizado de errores de pago.
 * Mapeo de códigos externos (Stripe, MP, etc.) a códigos internos.
 * Los controllers/services solo lanzan PaymentException con estos códigos.
 */

export enum PaymentErrorCode {
  // Fondos / límites
  INSUFFICIENT_FUNDS      = 'INSUFFICIENT_FUNDS',
  EXCEEDS_LIMIT           = 'EXCEEDS_LIMIT',

  // Tarjeta
  CARD_DECLINED           = 'CARD_DECLINED',
  CARD_EXPIRED            = 'CARD_EXPIRED',
  CARD_INVALID_NUMBER     = 'CARD_INVALID_NUMBER',
  CARD_INVALID_CVV        = 'CARD_INVALID_CVV',
  CARD_INVALID_EXPIRY     = 'CARD_INVALID_EXPIRY',
  CARD_NOT_SUPPORTED      = 'CARD_NOT_SUPPORTED',

  // Fraude / seguridad
  FRAUD_SUSPECTED         = 'FRAUD_SUSPECTED',
  DO_NOT_HONOR            = 'DO_NOT_HONOR',
  LOST_CARD               = 'LOST_CARD',
  STOLEN_CARD             = 'STOLEN_CARD',
  BLACKLISTED_USER        = 'BLACKLISTED_USER',

  // Procesamiento
  PROCESSING_ERROR        = 'PROCESSING_ERROR',
  DUPLICATE_TRANSACTION   = 'DUPLICATE_TRANSACTION',
  CURRENCY_NOT_SUPPORTED  = 'CURRENCY_NOT_SUPPORTED',
  AMOUNT_TOO_SMALL        = 'AMOUNT_TOO_SMALL',
  AMOUNT_TOO_LARGE        = 'AMOUNT_TOO_LARGE',

  // Vouchers / cash
  VOUCHER_EXPIRED         = 'VOUCHER_EXPIRED',

  // Documentos / identidad
  DOCUMENT_INVALID        = 'DOCUMENT_INVALID',

  // PIX
  PIX_KEY_NOT_FOUND       = 'PIX_KEY_NOT_FOUND',

  // Autenticación 3DS
  AUTHENTICATION_REQUIRED = 'AUTHENTICATION_REQUIRED',
  AUTHENTICATION_FAILED   = 'AUTHENTICATION_FAILED',

  // Provider
  PROVIDER_UNAVAILABLE    = 'PROVIDER_UNAVAILABLE',
  PROVIDER_TIMEOUT        = 'PROVIDER_TIMEOUT',
  PROVIDER_UNKNOWN        = 'PROVIDER_UNKNOWN',
}

export interface PaymentErrorMeta {
  code: PaymentErrorCode;
  retryable: boolean;
  httpStatus: number;
  message: string;
}

export const PAYMENT_ERROR_CATALOG: Record<PaymentErrorCode, PaymentErrorMeta> = {
  [PaymentErrorCode.INSUFFICIENT_FUNDS]:      { code: PaymentErrorCode.INSUFFICIENT_FUNDS,      retryable: false, httpStatus: 402, message: 'Fondos insuficientes' },
  [PaymentErrorCode.EXCEEDS_LIMIT]:           { code: PaymentErrorCode.EXCEEDS_LIMIT,           retryable: false, httpStatus: 402, message: 'Excede el límite de la cuenta' },
  [PaymentErrorCode.CARD_DECLINED]:           { code: PaymentErrorCode.CARD_DECLINED,           retryable: false, httpStatus: 402, message: 'Tarjeta rechazada' },
  [PaymentErrorCode.CARD_EXPIRED]:            { code: PaymentErrorCode.CARD_EXPIRED,            retryable: false, httpStatus: 402, message: 'Tarjeta vencida' },
  [PaymentErrorCode.CARD_INVALID_NUMBER]:     { code: PaymentErrorCode.CARD_INVALID_NUMBER,     retryable: false, httpStatus: 422, message: 'Número de tarjeta inválido' },
  [PaymentErrorCode.CARD_INVALID_CVV]:        { code: PaymentErrorCode.CARD_INVALID_CVV,        retryable: false, httpStatus: 422, message: 'CVV inválido' },
  [PaymentErrorCode.CARD_INVALID_EXPIRY]:     { code: PaymentErrorCode.CARD_INVALID_EXPIRY,     retryable: false, httpStatus: 422, message: 'Fecha de expiración inválida' },
  [PaymentErrorCode.CARD_NOT_SUPPORTED]:      { code: PaymentErrorCode.CARD_NOT_SUPPORTED,      retryable: false, httpStatus: 422, message: 'Tipo de tarjeta no soportado' },
  [PaymentErrorCode.FRAUD_SUSPECTED]:         { code: PaymentErrorCode.FRAUD_SUSPECTED,         retryable: false, httpStatus: 402, message: 'Transacción sospechosa de fraude' },
  [PaymentErrorCode.DO_NOT_HONOR]:            { code: PaymentErrorCode.DO_NOT_HONOR,            retryable: false, httpStatus: 402, message: 'Tarjeta no habilitada para esta operación' },
  [PaymentErrorCode.LOST_CARD]:               { code: PaymentErrorCode.LOST_CARD,               retryable: false, httpStatus: 402, message: 'Tarjeta reportada como perdida' },
  [PaymentErrorCode.STOLEN_CARD]:             { code: PaymentErrorCode.STOLEN_CARD,             retryable: false, httpStatus: 402, message: 'Tarjeta reportada como robada' },
  [PaymentErrorCode.BLACKLISTED_USER]:        { code: PaymentErrorCode.BLACKLISTED_USER,        retryable: false, httpStatus: 403, message: 'Usuario en lista negra' },
  [PaymentErrorCode.PROCESSING_ERROR]:        { code: PaymentErrorCode.PROCESSING_ERROR,        retryable: true,  httpStatus: 502, message: 'Error de procesamiento, reintentá' },
  [PaymentErrorCode.DUPLICATE_TRANSACTION]:   { code: PaymentErrorCode.DUPLICATE_TRANSACTION,   retryable: false, httpStatus: 409, message: 'Transacción duplicada' },
  [PaymentErrorCode.CURRENCY_NOT_SUPPORTED]:  { code: PaymentErrorCode.CURRENCY_NOT_SUPPORTED,  retryable: false, httpStatus: 422, message: 'Moneda no soportada por el provider' },
  [PaymentErrorCode.AMOUNT_TOO_SMALL]:        { code: PaymentErrorCode.AMOUNT_TOO_SMALL,        retryable: false, httpStatus: 422, message: 'Monto mínimo no alcanzado' },
  [PaymentErrorCode.AMOUNT_TOO_LARGE]:        { code: PaymentErrorCode.AMOUNT_TOO_LARGE,        retryable: false, httpStatus: 422, message: 'Monto máximo superado' },
  [PaymentErrorCode.VOUCHER_EXPIRED]:         { code: PaymentErrorCode.VOUCHER_EXPIRED,         retryable: false, httpStatus: 410, message: 'El voucher de pago ha expirado' },
  [PaymentErrorCode.DOCUMENT_INVALID]:        { code: PaymentErrorCode.DOCUMENT_INVALID,        retryable: false, httpStatus: 422, message: 'Documento de identidad inválido' },
  [PaymentErrorCode.PIX_KEY_NOT_FOUND]:       { code: PaymentErrorCode.PIX_KEY_NOT_FOUND,       retryable: false, httpStatus: 422, message: 'Clave PIX no encontrada' },
  [PaymentErrorCode.AUTHENTICATION_REQUIRED]: { code: PaymentErrorCode.AUTHENTICATION_REQUIRED, retryable: false, httpStatus: 402, message: 'Se requiere autenticación 3DS' },
  [PaymentErrorCode.AUTHENTICATION_FAILED]:   { code: PaymentErrorCode.AUTHENTICATION_FAILED,   retryable: false, httpStatus: 402, message: 'Autenticación 3DS fallida' },
  [PaymentErrorCode.PROVIDER_UNAVAILABLE]:    { code: PaymentErrorCode.PROVIDER_UNAVAILABLE,    retryable: true,  httpStatus: 503, message: 'Provider temporalmente no disponible' },
  [PaymentErrorCode.PROVIDER_TIMEOUT]:        { code: PaymentErrorCode.PROVIDER_TIMEOUT,        retryable: true,  httpStatus: 504, message: 'Timeout del provider' },
  [PaymentErrorCode.PROVIDER_UNKNOWN]:        { code: PaymentErrorCode.PROVIDER_UNKNOWN,        retryable: false, httpStatus: 502, message: 'Error desconocido del provider' },
};
