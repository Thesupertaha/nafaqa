import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsIn(['ar', 'en'])
  preferredLanguage?: 'ar' | 'en';

  @IsOptional()
  @IsIn(['EG', 'AE', 'SA'])
  preferredCountryCode?: 'EG' | 'AE' | 'SA';

  @IsOptional()
  @IsString()
  defaultCurrencyCode?: string;
}
