import { BadRequestException } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';

/**
 * Transiciones válidas del estado de un pago.
 * Rechaza cualquier salto no autorizado con una excepción.
 *
 *   PENDING → AUTHORIZED → CAPTURED
 *   PENDING → FAILED
 *   PENDING → CANCELLED
 *   AUTHORIZED → CAPTURED
 *   AUTHORIZED → FAILED
 *   AUTHORIZED → CANCELLED
 *   CAPTURED → REFUNDED
 *   CAPTURED → PARTIALLY_REFUNDED
 *   PARTIALLY_REFUNDED → REFUNDED
 */
const VALID_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  [PaymentStatus.PENDING]: [
    PaymentStatus.AUTHORIZED,
    PaymentStatus.CAPTURED,
    PaymentStatus.FAILED,
    PaymentStatus.CANCELLED,
  ],
  [PaymentStatus.AUTHORIZED]: [
    PaymentStatus.CAPTURED,
    PaymentStatus.FAILED,
    PaymentStatus.CANCELLED,
  ],
  [PaymentStatus.CAPTURED]: [
    PaymentStatus.REFUNDED,
    PaymentStatus.PARTIALLY_REFUNDED,
  ],
  [PaymentStatus.PARTIALLY_REFUNDED]: [
    PaymentStatus.REFUNDED,
  ],
  // Estados terminales — sin transiciones posibles
  [PaymentStatus.FAILED]:             [],
  [PaymentStatus.CANCELLED]:          [],
  [PaymentStatus.REFUNDED]:           [],
};

export function assertValidTransition(
  from: PaymentStatus,
  to: PaymentStatus,
): void {
  if (from === to) return; // idempotente: mismo estado es válido

  const allowed = VALID_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new BadRequestException(
      `Transición de estado inválida: ${from} → ${to}`,
    );
  }
}

export function isTerminal(status: PaymentStatus): boolean {
  return VALID_TRANSITIONS[status]?.length === 0;
}
