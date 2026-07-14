import { IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateBudgetDto {
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsNumber()
  @Min(0.01)
  @Type(() => Number)
  limitAmount!: number;

  @IsString()
  currencyCode!: string;

  @IsIn(['weekly', 'monthly', 'yearly'])
  period!: 'weekly' | 'monthly' | 'yearly';

  @IsDateString()
  startDate!: string;
}
