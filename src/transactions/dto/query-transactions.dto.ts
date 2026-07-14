import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsNumber, IsOptional, IsUUID, Min } from 'class-validator';

export class QueryTransactionsDto {
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  accountId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  minAmount?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  maxAmount?: number;

  @IsOptional()
  @IsIn(['chat', 'manual', 'import'])
  sourceType?: 'chat' | 'manual' | 'import';

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  pageSize?: number = 25;
}
