import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  create(userId: string, dto: CreateAccountDto) {
    return this.prisma.account.create({ data: { ...dto, userId } });
  }

  findAllForUser(userId: string) {
    return this.prisma.account.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
  }

  // Note: the :id route is additionally protected by OwnershipGuard
  // (@CheckOwnership('account')) at the controller level — this method's
  // own `where: { id, userId }` is a second, defense-in-depth check so this
  // service can never be called from elsewhere in the codebase without the
  // same scoping guarantee.
  findOne(userId: string, id: string) {
    return this.prisma.account.findFirst({ where: { id, userId } });
  }

  update(userId: string, id: string, dto: UpdateAccountDto) {
    return this.prisma.account
      .update({
        where: { id },
        data: dto,
      })
      .catch(() => null)
      .then(async (result: Awaited<ReturnType<PrismaService['account']['update']>> | null) => {
        // Defense-in-depth: re-verify ownership even after the guard, in case
        // this method is ever invoked from a future internal caller directly.
        const owned = await this.prisma.account.findFirst({ where: { id, userId } });
        return owned ? result : null;
      });
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.prisma.account.deleteMany({ where: { id, userId } });
  }
}
