import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Transactions (e2e) — ownership isolation', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const userAEmail = `e2e-a-${Date.now()}@example.com`;
  const userBEmail = `e2e-b-${Date.now()}@example.com`;
  let userAToken: string;
  let userBToken: string;
  let userATransactionId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: 1 as any, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = moduleFixture.get(PrismaService);

    const registerA = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: userAEmail, password: 'Password123', displayName: 'User A' });
    userAToken = registerA.body.accessToken;

    const registerB = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: userBEmail, password: 'Password123', displayName: 'User B' });
    userBToken = registerB.body.accessToken;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [userAEmail, userBEmail] } } });
    await app.close();
  });

  it('creates a transaction for user A', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        amount: 45,
        currencyCode: 'AED',
        transactionType: 'debit',
        sourceType: 'manual',
        occurredAt: new Date().toISOString(),
        idempotencyKey: `idem-${Date.now()}`,
      })
      .expect(201);

    userATransactionId = response.body.id;
    expect(response.body.amount).toBe('45');
  });

  it("prevents user B from reading user A's transaction (returns 404, not 403)", async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/transactions/${userATransactionId}`)
      .set('Authorization', `Bearer ${userBToken}`)
      .expect(404);
  });

  it("prevents user B from deleting user A's transaction", async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/transactions/${userATransactionId}`)
      .set('Authorization', `Bearer ${userBToken}`)
      .expect(404);

    // Confirm it still exists for user A afterward.
    await request(app.getHttpServer())
      .get(`/api/v1/transactions/${userATransactionId}`)
      .set('Authorization', `Bearer ${userAToken}`)
      .expect(200);
  });

  it('is idempotent: retrying the same creation request does not duplicate the transaction', async () => {
    const idempotencyKey = `idem-fixed-${Date.now()}`;
    const payload = {
      amount: 100,
      currencyCode: 'EGP',
      transactionType: 'debit',
      sourceType: 'manual',
      occurredAt: new Date().toISOString(),
      idempotencyKey,
    };

    const first = await request(app.getHttpServer())
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${userAToken}`)
      .send(payload)
      .expect(201);

    const second = await request(app.getHttpServer())
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${userAToken}`)
      .send(payload)
      .expect(201);

    expect(second.body.id).toBe(first.body.id);
  });
});
