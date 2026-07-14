import { Test, TestingModule } from '@nestjs/testing';
import { TransactionsService } from './transactions.service';
import { PrismaService } from '../prisma/prisma.service';

describe('TransactionsService', () => {
  let service: TransactionsService;
  let prisma: {
    transaction: any;
    auditLog: any;
  };

  beforeEach(async () => {
    prisma = {
      transaction: {
        findUnique: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [TransactionsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<TransactionsService>(TransactionsService);
  });

  const baseDto = {
    amount: 45,
    currencyCode: 'AED',
    transactionType: 'debit' as const,
    sourceType: 'chat' as const,
    occurredAt: new Date().toISOString(),
    idempotencyKey: 'client-generated-key-123',
  };

  it('creates a new transaction and writes an audit log when no idempotency match exists', async () => {
    prisma.transaction.findUnique.mockResolvedValue(null);
    prisma.transaction.create.mockResolvedValue({ id: 'txn-1', ...baseDto });

    const result = await service.create('user-1', baseDto);

    expect(prisma.transaction.create).toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'create', entityType: 'transaction' }),
      }),
    );
    expect(result.id).toBe('txn-1');
  });

  it('returns the existing transaction instead of creating a duplicate on a retried idempotency key', async () => {
    const existing = { id: 'txn-1', ...baseDto };
    prisma.transaction.findUnique.mockResolvedValue(existing);

    const result = await service.create('user-1', baseDto);

    expect(prisma.transaction.create).not.toHaveBeenCalled();
    expect(result).toBe(existing);
  });

  it('scopes the idempotency lookup to the requesting user only', async () => {
    prisma.transaction.findUnique.mockResolvedValue(null);
    prisma.transaction.create.mockResolvedValue({ id: 'txn-2', ...baseDto });

    await service.create('user-42', baseDto);

    expect(prisma.transaction.findUnique).toHaveBeenCalledWith({
      where: {
        userId_idempotencyKey: { userId: 'user-42', idempotencyKey: baseDto.idempotencyKey },
      },
    });
  });

  it('soft-deletes rather than hard-deleting a transaction', async () => {
    prisma.transaction.findFirst.mockResolvedValue({ id: 'txn-1', userId: 'user-1' });
    prisma.transaction.update.mockResolvedValue({ id: 'txn-1', deletedAt: new Date() });

    const result = await service.remove('user-1', 'txn-1');

    expect(result).toBe(true);
    expect(prisma.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'txn-1' },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );
  });

  it('returns false when attempting to delete a transaction the user does not own', async () => {
    prisma.transaction.findFirst.mockResolvedValue(null);

    const result = await service.remove('user-1', 'someone-elses-txn');

    expect(result).toBe(false);
    expect(prisma.transaction.update).not.toHaveBeenCalled();
  });

  it('caps pageSize at 100 regardless of client-requested size', async () => {
    prisma.transaction.findMany.mockResolvedValue([]);
    prisma.transaction.count.mockResolvedValue(0);

    await service.findAllForUser('user-1', { page: 1, pageSize: 5000 } as any);

    expect(prisma.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    );
  });
});
