import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: any;
    country: any;
    refreshTokenFamily: any;
  };
  let jwtService: JwtService;

  const mockConfig = {
    get: jest.fn().mockReturnValue({
      accessSecret: 'test-access-secret',
      refreshSecret: 'test-refresh-secret',
      accessExpiresIn: '1h',
      refreshFamilyTtlDays: 30,
    }),
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      country: {
        findUnique: jest.fn().mockResolvedValue({ defaultCurrencyCode: 'EGP' }),
      },
      refreshTokenFamily: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        JwtService,
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jwtService = module.get<JwtService>(JwtService);
  });

  describe('register', () => {
    it('rejects registration with an already-used email', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });

      await expect(
        service.register({
          email: 'mona@example.com',
          password: 'Password123',
          displayName: 'Mona',
        }),
      ).rejects.toThrow('An account with this email already exists');
    });

    it('creates a new user with a hashed password, never storing plaintext', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'new-user-id', ...data }),
      );
      prisma.refreshTokenFamily.create.mockResolvedValue({
        id: 'family-1',
        currentSeq: 0,
      });

      await service.register({
        email: 'mona@example.com',
        password: 'Password123',
        displayName: 'Mona',
      });

      const createCallArg = prisma.user.create.mock.calls[0][0].data;
      expect(createCallArg.passwordHash).not.toBe('Password123');
      expect(await bcrypt.compare('Password123', createCallArg.passwordHash)).toBe(true);
    });
  });

  describe('login', () => {
    it('returns the same error for a nonexistent email and a wrong password (no user enumeration)', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      const errorForMissingUser = await service
        .login({ email: 'ghost@example.com', password: 'whatever' })
        .catch((e) => e.message);

      const hash = await bcrypt.hash('correct-password', 4);
      prisma.user.findUnique.mockResolvedValueOnce({
        id: 'u1',
        passwordHash: hash,
        status: 'active',
      });
      const errorForWrongPassword = await service
        .login({ email: 'mona@example.com', password: 'wrong-password' })
        .catch((e) => e.message);

      expect(errorForMissingUser).toBe(errorForWrongPassword);
    });
  });

  describe('refresh — token family reuse detection', () => {
    it('rotates the sequence number on a legitimate, in-order refresh', async () => {
      const familyId = 'fam-1';
      const refreshToken = await jwtService.signAsync(
        { sub: 'u1', familyId, seq: 0, jti: 'jti-0' },
        { secret: 'test-refresh-secret' },
      );

      prisma.refreshTokenFamily.findUnique.mockResolvedValue({
        id: familyId,
        userId: 'u1',
        currentSeq: 0,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 100000),
      });
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', status: 'active', email: 'mona@example.com' });
      prisma.refreshTokenFamily.update.mockResolvedValue({});

      const result = await service.refresh(refreshToken);

      expect(result.accessToken).toBeDefined();
      expect(prisma.refreshTokenFamily.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: familyId },
          data: expect.objectContaining({ currentSeq: 1 }),
        }),
      );
    });

    it('detects reuse of an already-rotated token and revokes the entire family', async () => {
      const familyId = 'fam-2';
      // This token claims seq 0, but the family has already moved to seq 1
      // (i.e. it was already used once) — this is exactly the "stolen and
      // replayed" scenario the Security Review's Section 6 design targets.
      const staleRefreshToken = await jwtService.signAsync(
        { sub: 'u1', familyId, seq: 0, jti: 'jti-0' },
        { secret: 'test-refresh-secret' },
      );

      prisma.refreshTokenFamily.findUnique.mockResolvedValue({
        id: familyId,
        userId: 'u1',
        currentSeq: 1, // already rotated past seq 0
        revokedAt: null,
        expiresAt: new Date(Date.now() + 100000),
      });
      prisma.refreshTokenFamily.update.mockResolvedValue({});

      await expect(service.refresh(staleRefreshToken)).rejects.toThrow(UnauthorizedException);

      expect(prisma.refreshTokenFamily.update).toHaveBeenCalledWith({
        where: { id: familyId },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('rejects a refresh against an already-revoked family', async () => {
      const familyId = 'fam-3';
      const refreshToken = await jwtService.signAsync(
        { sub: 'u1', familyId, seq: 0, jti: 'jti-0' },
        { secret: 'test-refresh-secret' },
      );

      prisma.refreshTokenFamily.findUnique.mockResolvedValue({
        id: familyId,
        userId: 'u1',
        currentSeq: 0,
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 100000),
      });

      await expect(service.refresh(refreshToken)).rejects.toThrow(UnauthorizedException);
    });
  });
});
