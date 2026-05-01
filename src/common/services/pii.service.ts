import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * Cifrado de PII (Personally Identifiable Information) at-rest.
 *
 * Algoritmo: AES-256-GCM (autenticado — detecta tampering).
 * Clave:      PII_ENCRYPTION_KEY (32 bytes hex en .env)
 *
 * Formato del campo cifrado: `enc:v1:<iv_hex>:<tag_hex>:<ciphertext_hex>`
 * El prefijo `enc:v1:` permite detectar campos ya cifrados (idempotente)
 * y facilita futuras migraciones de versión de cifrado.
 *
 * Generar una clave segura:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
@Injectable()
export class PiiService implements OnModuleInit {
  private readonly logger = new Logger(PiiService.name);
  private key!: Buffer;
  private readonly VERSION = 'enc:v1:';

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const keyHex = this.config.get<string>('PII_ENCRYPTION_KEY');
    if (!keyHex) {
      this.logger.warn(
        'PII_ENCRYPTION_KEY no configurada — PII no será cifrada. ' +
        'Requerida en producción.',
      );
      return;
    }
    if (keyHex.length !== 64) {
      throw new Error('PII_ENCRYPTION_KEY debe ser 32 bytes hex (64 caracteres).');
    }
    this.key = Buffer.from(keyHex, 'hex');
  }

  /** Cifra un valor. Idempotente: si ya está cifrado lo retorna tal cual. */
  encrypt(plaintext: string): string {
    if (!this.key || plaintext.startsWith(this.VERSION)) return plaintext;

    const iv         = crypto.randomBytes(12); // 96 bits para GCM
    const cipher     = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted  = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return `${this.VERSION}${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  /** Descifra un valor. Si no está cifrado lo retorna tal cual. */
  decrypt(ciphertext: string): string {
    if (!this.key || !ciphertext.startsWith(this.VERSION)) return ciphertext;

    const parts = ciphertext.slice(this.VERSION.length).split(':');
    if (parts.length !== 3) throw new Error('Formato de cifrado inválido.');

    const [ivHex, tagHex, dataHex] = parts;
    const iv      = Buffer.from(ivHex,  'hex');
    const tag     = Buffer.from(tagHex, 'hex');
    const data    = Buffer.from(dataHex,'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }

  /** Hashea un valor para búsquedas (SHA-256 con salt fijo por instalación). */
  searchHash(value: string): string {
    const salt = this.config.get<string>('PII_SEARCH_SALT') ?? 'default-salt';
    return crypto.createHash('sha256').update(salt + value).digest('hex');
  }

  isEncrypted(value: string): boolean {
    return value.startsWith(this.VERSION);
  }
}
