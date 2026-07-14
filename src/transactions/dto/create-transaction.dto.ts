import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
} from 'class-validator';

export class CreateTransactionDto {
  @IsNumber()
  @Min(0.01)
  @Type(() => Number)
  amount!: number;

  @IsString()
  @Length(3, 3)
  currencyCode!: string;

  @IsOptional()
  @IsUUID()
  accountId?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsString()
  merchantRaw?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsIn(['debit', 'credit'])
  transactionType!: 'debit' | 'credit';

  @IsIn(['chat', 'manual', 'import'])
  sourceType!: 'chat' | 'manual' | 'import';

  @IsDateString()
  occurredAt!: string;

  /**
   * Client-generated idempotency key (per the Mobile App Design's offline
   * Outbox pattern and the Security Review's F6 fix) — scoped to
   * (userId, idempotencyKey) uniqueness in the service layer, so a retried
   * request after a dropped connection can never create a duplicate
   * transaction, and a stolen token cannot collide against another user's
   * key space.
   */
  @IsString()
  idempotencyKey!: string;
}
