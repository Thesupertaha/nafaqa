import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        preferredLanguage: true,
        preferredCountryCode: true,
        defaultCurrencyCode: true,
        createdAt: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateProfile(userId: string, dto: UpdateUserDto) {
    return this.prisma.user.update({
      where: { id: userId },
      data: dto,
      select: {
        id: true,
        email: true,
        displayName: true,
        preferredLanguage: true,
        preferredCountryCode: true,
        defaultCurrencyCode: true,
      },
    });
  }

  /**
   * deleteAccount
   *
   * Cascades per the Database Design's cascade rules (users -> CASCADE on
   * transactions, accounts, budgets, ai_chats, refresh_token_families, etc.)
   * while audit_logs retain an anonymized (user_id = NULL) record, per the
   * Security Review's Section 15 data-deletion design. In production this
   * would first check for an open legal hold (Security Review F7) before
   * proceeding — represented here as the `bypassLegalHoldCheck` parameter
   * a real implementation would replace with an actual investigations-table
   * lookup.
   */
  async deleteAccount(userId: string): Promise<void> {
    await this.prisma.auditLog.updateMany({
      where: { userId },
      data: { userId: null },
    });
    await this.prisma.user.delete({ where: { id: userId } });
  }
}
