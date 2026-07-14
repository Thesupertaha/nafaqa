import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { nanoid } from 'nanoid';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AppConfig } from '../config/configuration';

interface RefreshPayload {
  sub: string;
  familyId: string;
  seq: number;
  jti: string;
}

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const countryCode = dto.preferredCountryCode ?? 'EG';
    const country = await this.prisma.country.findUnique({ where: { isoCode: countryCode } });

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        displayName: dto.displayName,
        preferredLanguage: dto.preferredLanguage ?? 'en',
        preferredCountryCode: countryCode,
        defaultCurrencyCode: country?.defaultCurrencyCode ?? 'EGP',
      },
    });

    return this.issueSessionTokens(user.id, user.email ?? undefined);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      // Deliberately identical error for "no such user" and "wrong password"
      // to avoid user-enumeration via distinct error messages.
      throw new UnauthorizedException('Invalid email or password');
    }
    if (user.status !== 'active') {
      throw new UnauthorizedException('This account is not active');
    }

    return this.issueSessionTokens(user.id, user.email ?? undefined);
  }

  /**
   * refresh
   *
   * Implements the refresh-token-family reuse detection from the Security
   * Review (Section 6): a mismatch between the presented sequence number and
   * the family's current expected sequence is treated as proof of token
   * theft (an already-rotated token being replayed), and the ENTIRE family
   * is revoked immediately rather than just rejecting this one request.
   */
  async refresh(refreshToken: string) {
    let payload: RefreshPayload;
    try {
      payload = await this.jwtService.verifyAsync<RefreshPayload>(refreshToken, {
        secret: this.configService.get('jwt', { infer: true }).refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const family = await this.prisma.refreshTokenFamily.findUnique({
      where: { id: payload.familyId },
    });

    if (!family || family.revokedAt || family.expiresAt < new Date()) {
      throw new UnauthorizedException('Session expired — please sign in again');
    }

    if (family.currentSeq !== payload.seq) {
      // Reuse detected: kill the whole family, forcing full re-auth on every
      // device that shared this session.
      await this.prisma.refreshTokenFamily.update({
        where: { id: family.id },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException(
        'Security check failed — this session has been revoked. Please sign in again.',
      );
    }

    const user = await this.prisma.user.findUnique({ where: { id: family.userId } });
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('Account is not active');
    }

    const nextSeq = family.currentSeq + 1;
    const newJti = nanoid();

    await this.prisma.refreshTokenFamily.update({
      where: { id: family.id },
      data: { currentSeq: nextSeq, lastUsedHash: newJti },
    });

    const accessToken = await this.signAccessToken(user.id, user.email ?? undefined);
    const newRefreshToken = await this.signRefreshToken(family.id, nextSeq, newJti, user.id);

    return { accessToken, refreshToken: newRefreshToken };
  }

  /** Revokes the refresh token family — used by the "sign out this device" flow. */
  async logout(refreshToken: string): Promise<void> {
    try {
      const payload = await this.jwtService.verifyAsync<RefreshPayload>(refreshToken, {
        secret: this.configService.get('jwt', { infer: true }).refreshSecret,
      });
      await this.prisma.refreshTokenFamily.update({
        where: { id: payload.familyId },
        data: { revokedAt: new Date() },
      });
    } catch {
      // Already invalid/expired — logout is idempotent, nothing further to do.
    }
  }

  private async issueSessionTokens(userId: string, email?: string) {
    const ttlDays = this.configService.get('jwt', { infer: true }).refreshFamilyTtlDays;
    const jti = nanoid();

    const family = await this.prisma.refreshTokenFamily.create({
      data: {
        userId,
        currentSeq: 0,
        lastUsedHash: jti,
        expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
      },
    });

    const accessToken = await this.signAccessToken(userId, email);
    const refreshToken = await this.signRefreshToken(family.id, 0, jti, userId);

    return { accessToken, refreshToken };
  }

  private signAccessToken(userId: string, email?: string) {
    return this.jwtService.signAsync(
      { sub: userId, email },
      {
        secret: this.configService.get('jwt', { infer: true }).accessSecret,
        expiresIn: this.configService.get('jwt', { infer: true }).accessExpiresIn,
      },
    );
  }

  private signRefreshToken(familyId: string, seq: number, jti: string, userId: string) {
    const payload: RefreshPayload = { sub: userId, familyId, seq, jti };
    return this.jwtService.signAsync(payload, {
      secret: this.configService.get('jwt', { infer: true }).refreshSecret,
      expiresIn: `${this.configService.get('jwt', { infer: true }).refreshFamilyTtlDays}d`,
    });
  }
}
