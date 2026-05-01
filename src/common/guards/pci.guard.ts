import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';

/**
 * PCI-DSS Scope Mínimo.
 *
 * Rechaza cualquier request que contenga datos de tarjeta en el body.
 * Los clientes DEBEN tokenizar en el frontend con el SDK del provider
 * (Stripe.js, MercadoPago SDK, etc.) antes de llamar a nuestra API.
 *
 * Patterns detectados:
 *   - PAN: secuencias de 13-19 dígitos (Luhn-like)
 *   - CVV/CVC: campos llamados cvv, cvc, security_code
 *   - Track data: pistas de banda magnética
 */
@Injectable()
export class PciGuard implements CanActivate {
  private readonly logger = new Logger(PciGuard.name);

  // Regex para detectar PAN (número de tarjeta) — 13-19 dígitos seguidos
  private readonly PAN_REGEX = /\b[0-9]{13,19}\b/;

  // Nombres de campo prohibidos
  private readonly FORBIDDEN_FIELDS = new Set([
    'card_number', 'cardnumber', 'pan',
    'cvv', 'cvc', 'cvc2', 'cvv2', 'security_code',
    'track1', 'track2', 'magnetic_stripe',
  ]);

  canActivate(context: ExecutionContext): boolean {
    const req  = context.switchToHttp().getRequest<Record<string, any>>();
    const body = req.body;

    if (!body || typeof body !== 'object') return true;

    // 1. Detectar campos prohibidos por nombre
    const flatKeys = this.flatKeys(body);
    for (const key of flatKeys) {
      if (this.FORBIDDEN_FIELDS.has(key.toLowerCase())) {
        this.logger.warn(
          `⚠️  PCI violation: campo prohibido detectado en request: ${key} ` +
          `path=${req.url} ip=${req.ip}`,
        );
        throw new UnprocessableEntityException(
          'No envíes datos de tarjeta directamente. ' +
          'Tokenizá con el SDK del provider en el frontend.',
        );
      }
    }

    // 2. Detectar PAN en valores de string
    const bodyStr = JSON.stringify(body);
    if (this.PAN_REGEX.test(bodyStr)) {
      this.logger.warn(
        `⚠️  PCI violation: posible PAN detectado en body path=${req.url} ip=${req.ip}`,
      );
      throw new UnprocessableEntityException(
        'No envíes datos de tarjeta directamente. ' +
        'Tokenizá con el SDK del provider en el frontend.',
      );
    }

    return true;
  }

  private flatKeys(obj: Record<string, any>, prefix = ''): string[] {
    return Object.keys(obj).flatMap((k) => {
      const full = prefix ? `${prefix}.${k}` : k;
      if (obj[k] && typeof obj[k] === 'object' && !Array.isArray(obj[k])) {
        return [k, ...this.flatKeys(obj[k], full)];
      }
      return [k];
    });
  }
}
