import { IsBoolean, IsIn, IsOptional, IsString, Length } from 'class-validator';

export class CreateAccountDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  @Length(4, 4)
  accountNumberLast4?: string;

  @IsString()
  @Length(3, 3)
  currencyCode!: string;

  @IsIn(['bank', 'cash', 'wallet', 'credit_card'])
  accountType!: 'bank' | 'cash' | 'wallet' | 'credit_card';

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
