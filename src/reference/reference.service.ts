import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReferenceService {
  constructor(private readonly prisma: PrismaService) {}

  getCurrencies() {
    return this.prisma.currency.findMany({ orderBy: { code: 'asc' } });
  }

  getCountries() {
    return this.prisma.country.findMany({ where: { isSupported: true } });
  }

  /**
   * getCategoriesForUser
   *
   * Returns system default categories PLUS this user's own custom ones —
   * never another user's custom categories, since category_id resolution
   * in the AI extraction validator (see ai/ai-extraction-validator.service.ts)
   * must only ever match against this exact set.
   */
  getCategoriesForUser(userId: string) {
    return this.prisma.category.findMany({
      where: { OR: [{ isSystem: true }, { userId }] },
      orderBy: { nameEn: 'asc' },
    });
  }
}
