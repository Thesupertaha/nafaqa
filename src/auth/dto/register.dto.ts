import { IsEmail, IsIn, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Password must contain upper, lower case letters and a number',
  })
  password!: string;

  @IsString()
  @MinLength(1)
  displayName!: string;

  @IsOptional()
  @IsIn(['ar', 'en'])
  preferredLanguage?: 'ar' | 'en';

  @IsOptional()
  @IsIn(['EG', 'AE', 'SA'])
  preferredCountryCode?: 'EG' | 'AE' | 'SA';
}
