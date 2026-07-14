import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';

export const OWNERSHIP_KEY = 'ownership_resource';

/**
 * @CheckOwnership('transaction') decorator — pairs with OwnershipGuard below.
 * Names the Prisma model (lowercase, matching the client accessor) whose
 * `:id` route param must belong to the current user.
 */
export const CheckOwnership = (resource: 'transaction' | 'account' | 'budget' | 'aiChat') =>
  SetMetadata(OWNERSHIP_KEY, resource);

/**
 * OwnershipGuard
 *
 * Implements the "OwnershipGuard" referenced throughout the System
 * Architecture and Security Review documents: a resource ID in the URL
 * (e.g. GET /transactions/:id) is only accessible if it belongs to
 * request.user.userId. A mismatch or non-existent ID both return 404 (never
 * 403) so this guard never leaks whether a given ID exists at all for
 * another user — a deliberate choice to avoid ID-enumeration information
 * disclosure (OWASP API1: Broken Object Level Authorization).
 */
@Injectable()
export class OwnershipGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const resource = this.reflector.get<string>(OWNERSHIP_KEY, context.getHandler());
    if (!resource) return true;

    const request = context.switchToHttp().getRequest();
    const resourceId = request.params.id;
    const userId = request.user?.userId;

    if (!resourceId || !userId) return false;

    const model = (this.prisma as any)[resource];
    const record = await model.findUnique({ where: { id: resourceId }, select: { userId: true } });

    if (!record || record.userId !== userId) {
      throw new NotFoundException(`${resource} not found`);
    }

    return true;
  }
}
