import {
  IsEmail,
  IsEnum,
  IsISO31661Alpha2,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Min,
} from 'class-validator';
import { PaymentMethodKind } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePaymentDto {
  @ApiProperty({ example: 10000, description: 'Monto en centavos (unidades mínimas)' })
  @IsInt()
  @Min(1)
  amountMinor!: number;

  @ApiProperty({ example: 'ARS', description: 'ISO-4217' })
  @IsString()
  @Length(3, 3)
  currency!: string;

  @ApiProperty({ example: 'AR', description: 'ISO-3166-1 alpha-2' })
  @IsISO31661Alpha2()
  country!: string;

  @ApiProperty({ enum: PaymentMethodKind })
  @IsEnum(PaymentMethodKind)
  method!: PaymentMethodKind;

  @ApiProperty({ example: 'cust_123' })
  @IsString()
  @IsNotEmpty()
  customerId!: string;

  @ApiPropertyOptional({ example: 'user@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'https://app.com/return' })
  @IsOptional()
  @IsUrl()
  returnUrl?: string;

  @ApiPropertyOptional({ example: { orderId: 'ord_abc' } })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, string>;
}
