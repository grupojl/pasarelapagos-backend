import { HttpException } from '@nestjs/common';
import {
  PaymentErrorCode,
  PAYMENT_ERROR_CATALOG,
} from './payment-error.catalog';

export class PaymentException extends HttpException {
  readonly code: PaymentErrorCode;
  readonly retryable: boolean;

  constructor(code: PaymentErrorCode, detail?: string) {
    const meta = PAYMENT_ERROR_CATALOG[code];
    super(
      {
        error: meta.code,
        message: detail ?? meta.message,
        retryable: meta.retryable,
      },
      meta.httpStatus,
    );
    this.code = code;
    this.retryable = meta.retryable;
  }
}
