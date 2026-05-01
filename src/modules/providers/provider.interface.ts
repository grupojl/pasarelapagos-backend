/**
 * Contrato que toda pasarela externa DEBE implementar.
 * Mantenelo minimal y estable: cambios aqui impactan a todos los adapters.
 */
export interface PaymentProvider {
  readonly id: string;        // 'stripe' | 'mercadopago' | 'modo' | ...
  readonly countries: string[]; // ISO-3166 alpha-2, p.ej. ['AR','UY']
  readonly currencies: string[]; // ISO-4217

  createCharge(input: CreateChargeInput): Promise<ProviderChargeResult>;
  capture?(chargeId: string): Promise<ProviderChargeResult>;
  refund(input: RefundInput): Promise<ProviderRefundResult>;
  retrieve(externalId: string): Promise<ProviderChargeResult>;
  verifyWebhook(raw: Buffer, headers: Record<string, string>): Promise<WebhookEvent>;
}

export interface CreateChargeInput {
  amountMinor: bigint;          // en unidades minimas (centavos)
  currency: string;             // ISO-4217
  country: string;              // ISO-3166-1 alpha-2
  customer: { id: string; email?: string; documentId?: string };
  description?: string;
  method: PaymentMethodKind;
  metadata?: Record<string, string>;
  idempotencyKey: string;
  returnUrl?: string;
}

export type PaymentMethodKind =
  | 'card'
  | 'wallet'
  | 'bank_transfer'
  | 'cash_voucher'
  | 'pix'
  | 'qr';

export interface ProviderChargeResult {
  externalId: string;
  status: 'pending' | 'authorized' | 'captured' | 'failed' | 'cancelled' | 'refunded';
  redirectUrl?: string;
  raw: unknown;
}

export interface RefundInput {
  externalId: string;
  amountMinor?: bigint; // null = total
  reason?: string;
}

export interface ProviderRefundResult {
  externalRefundId: string;
  status: 'pending' | 'succeeded' | 'failed';
  raw: unknown;
}

export interface WebhookEvent {
  providerId: string;
  eventType: string;
  externalId: string;
  status: ProviderChargeResult['status'];
  raw: unknown;
}
