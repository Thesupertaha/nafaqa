import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * JwtAuthGuard
 *
 * The first of the two enforcement layers described in the Security Review
 * (Section 3, Authorization) — verifies the bearer token's signature and
 * expiry via JwtStrategy. The second layer (row-level ownership checks)
 * lives in each service method, scoping every Prisma query to
 * request.user.userId (see OwnershipGuard for resource-specific checks and
 * TransactionsService/BudgetsService for query-level scoping).
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor() {
    super();
  }

  handleRequest(err: any, user: any, info: any, context: ExecutionContext) {
    if (err || !user) {
      throw err || new Error('Unauthorized');
    }
    return user;
  }
}
