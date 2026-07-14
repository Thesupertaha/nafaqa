import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * app.e2e-spec.ts
 *
 * Requires a real (test) PostgreSQL database reachable via DATABASE_URL —
 * see docker-compose.yml's `db` service and README.md's "Running tests"
 * section. CI runs `docker compose up -d db` and `prisma migrate deploy`
 * against a disposable test database before this suite executes.
 */
describe('AppModule (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: 1 as any, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/api/health (GET) reports ok when the database is reachable', () => {
    return request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect((res) => {
        expect(res.body.status).toBe('ok');
      });
  });

  it('rejects an unauthenticated request to a protected route', () => {
    return request(app.getHttpServer()).get('/api/v1/transactions').expect(401);
  });
});
