import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { QueryTransactionsDto } from './dto/query-transactions.dto';

@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * create
   *
   * Idempotent by (userId, idempotencyKey): a retried request after a
   * dropped connection (Mobile App Design's offline Outbox pattern) returns
   * the ALREADY-CREATED record instead of creating a duplicate, and does so
   * without ever leaking whether that key belongs to a different user
   * (impossible by construction, since the lookup is always scoped to the
   * caller's own userId).
   */
  async create(userId: string, dto: CreateTransactionDto) {
    const existing = await this.prisma.transaction.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey: dto.idempotencyKey } },
    });
    if (existing) return existing;

    const transaction = await this.prisma.transaction.create({
      data: {
        userId,
        accountId: dto.accountId,
        categoryId: dto.categoryId,
        amount: new Prisma.Decimal(dto.amount),
        currencyCode: dto.currencyCode,
        merchantRaw: dto.merchantRaw,
        description: dto.description,
        transactionType: dto.transactionType,
        sourceType: dto.sourceType,
        occurredAt: new Date(dto.occurredAt),
        idempotencyKey: dto.idempotencyKey,
        isUserConfirmed: dto.sourceType === 'manual', // manual entries are inherently user-confirmed
      },
    });

    await this.writeAuditLog(userId, transaction.id, 'create', null, transaction);
    return transaction;
  }

  async findAllForUser(userId: string, query: QueryTransactionsDto) {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 25, 100); // hard cap regardless of client-requested size

    const where: Prisma.TransactionWhereInput = {
      userId,
      deletedAt: null,
      ...(query.categoryId && { categoryId: query.categoryId }),
      ...(query.accountId && { accountId: query.accountId }),
      ...(query.sourceType && { sourceType: query.sourceType }),
      ...(query.from || query.to
        ? {
            occurredAt: {
              ...(query.from && { gte: new Date(query.from) }),
              ...(query.to && { lte: new Date(query.to) }),
            },
          }
        : {}),
      ...(query.minAmount !== undefined || query.maxAmount !== undefined
        ? {
            amount: {
              ...(query.minAmount !== undefined && { gte: new Prisma.Decimal(query.minAmount) }),
              ...(query.maxAmount !== undefined && { lte: new Prisma.Decimal(query.maxAmount) }),
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { category: true, account: true },
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  findOne(userId: string, id: string) {
    return this.prisma.transaction.findFirst({
      where: { id, userId, deletedAt: null },
      include: { category: true, account: true },
    });
  }

  async update(userId: string, id: string, dto: UpdateTransactionDto) {
    const before = await this.prisma.transaction.findFirst({ where: { id, userId } });
    if (!before) return null;

    const updated = await this.prisma.transaction.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.amount !== undefined && { amount: new Prisma.Decimal(dto.amount) }),
        ...(dto.occurredAt && { occurredAt: new Date(dto.occurredAt) }),
      },
    });

    await this.writeAuditLog(userId, id, 'update', before, updated);
    return updated;
  }

  /**
   * remove — soft delete only (per Database Design Section 8), preserving
   * a short "undo" window and the audit trail. Hard deletion only ever
   * happens as part of full account erasure (UsersService.deleteAccount).
   */
  async remove(userId: string, id: string): Promise<boolean> {
    const before = await this.prisma.transaction.findFirst({ where: { id, userId } });
    if (!before) return false;

    const deleted = await this.prisma.transaction.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.writeAuditLog(userId, id, 'delete', before, deleted);
    return true;
  }

  private async writeAuditLog(
    userId: string,
    transactionId: string,
    action: 'create' | 'update' | 'delete',
    before: unknown,
    after: unknown,
  ) {
    await this.prisma.auditLog.create({
      data: {
        userId,
        entityType: 'transaction',
        entityId: transactionId,
        action,
        beforeState: before ? JSON.parse(JSON.stringify(before)) : undefined,
        afterState: after ? JSON.parse(JSON.stringify(after)) : undefined,
      },
    });
  }
}
