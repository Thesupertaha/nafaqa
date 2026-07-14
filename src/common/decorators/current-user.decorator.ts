import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthenticatedUser {
  userId: string;
  email?: string;
}

/**
 * Extracts the JWT-verified user attached by JwtAuthGuard. Never trusts a
 * client-supplied userId in the request body for authorization decisions —
 * every service method scopes its query to this decorator's value.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
