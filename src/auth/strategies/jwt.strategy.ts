import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';

export interface JwtPayload {
  sub: string; // userId
  email?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService<AppConfig, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('jwt', { infer: true }).accessSecret,
    });
  }

  // Runs after signature + expiry verification succeeds. The returned value
  // becomes `request.user`, consumed by the @CurrentUser() decorator.
  async validate(payload: JwtPayload) {
    return { userId: payload.sub, email: payload.email };
  }
}
