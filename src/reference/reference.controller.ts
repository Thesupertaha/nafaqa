import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ReferenceService } from './reference.service';

@Controller({ path: 'reference', version: '1' })
export class ReferenceController {
  constructor(private readonly referenceService: ReferenceService) {}

  @Get('currencies')
  getCurrencies() {
    return this.referenceService.getCurrencies();
  }

  @Get('countries')
  getCountries() {
    return this.referenceService.getCountries();
  }

  @UseGuards(JwtAuthGuard)
  @Get('categories')
  getCategories(@CurrentUser() user: AuthenticatedUser) {
    return this.referenceService.getCategoriesForUser(user.userId);
  }
}
