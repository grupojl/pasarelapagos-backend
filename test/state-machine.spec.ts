import { assertValidTransition, isTerminal } from '../src/modules/payments/payment-state.machine';
import { PaymentStatus } from '@prisma/client';

/**
 * Tests unitarios del state machine — sin IO, rápidos.
 */
describe('PaymentStateMachine', () => {
  it('PENDING → CAPTURED es válido', () => {
    expect(() =>
      assertValidTransition(PaymentStatus.PENDING, PaymentStatus.CAPTURED),
    ).not.toThrow();
  });

  it('CAPTURED → PENDING lanza excepción', () => {
    expect(() =>
      assertValidTransition(PaymentStatus.CAPTURED, PaymentStatus.PENDING),
    ).toThrow();
  });

  it('mismo estado no lanza excepción (idempotente)', () => {
    expect(() =>
      assertValidTransition(PaymentStatus.PENDING, PaymentStatus.PENDING),
    ).not.toThrow();
  });

  it('FAILED es estado terminal', () => {
    expect(isTerminal(PaymentStatus.FAILED)).toBe(true);
  });

  it('PENDING no es estado terminal', () => {
    expect(isTerminal(PaymentStatus.PENDING)).toBe(false);
  });

  it('REFUNDED es estado terminal', () => {
    expect(isTerminal(PaymentStatus.REFUNDED)).toBe(true);
  });

  it('PARTIALLY_REFUNDED → REFUNDED es válido', () => {
    expect(() =>
      assertValidTransition(
        PaymentStatus.PARTIALLY_REFUNDED,
        PaymentStatus.REFUNDED,
      ),
    ).not.toThrow();
  });
});
