import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { UpdateBudgetDto } from './dto/update-budget.dto';

@Injectable()
export class BudgetsService {
  constructor(private readonly prisma: PrismaService) {}

  create(userId: string, dto: CreateBudgetDto) {
    return this.prisma.budget.create({
      data: { ...dto, userId, startDate: new Date(dto.startDate) },
    });
  }

  async findAllForUser(userId: string) {
    const budgets = await this.prisma.budget.findMany({
      where: { userId, isActive: true },
      include: { category: true },
      orderBy: { createdAt: 'asc' },
    });

    return Promise.all(
      budgets.map((budget: Awaited<ReturnType<typeof this.prisma.budget.findMany>>[number]) =>
        this.attachProgress(userId, budget),
      ),
    );
  }

  async findOne(userId: string, id: string) {
    const budget = await this.prisma.budget.findFirst({
      where: { id, userId },
      include: { category: true },
    });
    if (!budget) return null;
    return this.attachProgress(userId, budget);
  }

  update(userId: string, id: string, dto: UpdateBudgetDto) {
    return this.prisma.budget.updateMany({
      where: { id, userId },
      data: {
        ...dto,
        ...(dto.startDate && { startDate: new Date(dto.startDate) }),
      },
    });
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.prisma.budget.deleteMany({ where: { id, userId } });
  }

  /**
   * attachProgress
   *
   * Computes spent-so-far for the budget's current period window, mirroring
   * the three-tier warning logic from the Design System (Section 7:
   * normal / amber at 80% / coral at 100%+) so the mobile client can render
   * consistent thresholds without duplicating this calculation client-side.
   */
  private async attachProgress(userId: string, budget: {
    id: string;
    categoryId: string | null;
    limitAmount: Prisma.Decimal;
    period: string;
    startDate: Date;
    [key: string]: unknown;
  }) {
    const periodStart = this.currentPeriodStart(budget.startDate, budget.period);

    const spentResult = await this.prisma.transaction.aggregate({
      where: {
        userId,
        deletedAt: null,
        transactionType: 'debit',
        occurredAt: { gte: periodStart },
        ...(budget.categoryId ? { categoryId: budget.categoryId } : {}),
      },
      _sum: { amount: true },
    });

    const spent = spentResult._sum.amount ?? new Prisma.Decimal(0);
    const limit = budget.limitAmount;
    const percentUsed = limit.greaterThan(0) ? spent.dividedBy(limit).toNumber() * 100 : 0;

    let status: 'normal' | 'warning' | 'over' = 'normal';
    if (percentUsed >= 100) status = 'over';
    else if (percentUsed >= 80) status = 'warning';

    return { ...budget, spent, percentUsed: Math.round(percentUsed), status };
  }

  private currentPeriodStart(startDate: Date, period: string): Date {
    const now = new Date();
    if (period === 'weekly') {
      const dayOfWeek = now.getDay();
      const start = new Date(now);
      start.setDate(now.getDate() - dayOfWeek);
      start.setHours(0, 0, 0, 0);
      return start;
    }
    if (period === 'yearly') {
      return new Date(now.getFullYear(), 0, 1);
    }
    // monthly (default)
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }
}
