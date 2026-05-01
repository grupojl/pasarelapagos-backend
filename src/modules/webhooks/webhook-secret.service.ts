import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * Soporte de rotación de secretos para webhooks.
 *
 * Durante una ventana de rotación, acepta firmas con AMBOS secretos:
 *   WEBHOOK_SIGNING_SECRET          → secreto actual (nuevo)
 *   WEBHOOK_SIGNING_SECRET_PREVIOUS → secreto anterior (en rotación)
 *
 * Flujo de rotación:
 *   1. Setear WEBHOOK_SIGNING_SECRET_PREVIOUS = valor_actual
 *   2. Setear WEBHOOK_SIGNING_SECRET = nuevo_valor
 *   3. Actualizar los providers con el nuevo secreto
 *   4. Esperar N minutos (todos los webhooks en vuelo se validarán con ambos)
 *   5. Remover WEBHOOK_SIGNING_SECRET_PREVIOUS
 */
@Injectable()
export class WebhookSecretService {
  private readonly current:  string;
  private readonly previous: string | undefined;

  constructor(private readonly config: ConfigService) {
    this.current  = config.getOrThrow<string>('WEBHOOK_SIGNING_SECRET');
    this.previous = config.get<string>('WEBHOOK_SIGNING_SECRET_PREVIOUS');
  }

  /**
   * Verifica la firma HMAC-SHA256 aceptando el secreto actual y el anterior.
   * Retorna true si alguno es válido.
   */
  verify(raw: Buffer, signature: string): boolean {
    const clean = signature.replace('sha256=', '');

    const matchCurrent  = this.hmac(raw, this.current)  === clean;
    const matchPrevious = this.previous
      ? this.hmac(raw, this.previous) === clean
      : false;

    return matchCurrent || matchPrevious;
  }

  /**
   * Genera la firma con el secreto actual (para tests / re-envíos).
   */
  sign(raw: Buffer): string {
    return `sha256=${this.hmac(raw, this.current)}`;
  }

  private hmac(data: Buffer, secret: string): string {
    return crypto.createHmac('sha256', secret).update(data).digest('hex');
  }
}
