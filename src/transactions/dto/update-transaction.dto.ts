import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateTransactionDto } from './create-transaction.dto';

// idempotencyKey and sourceType are not editable after creation — the key
// only matters at creation time (retry safety), and changing sourceType
// after the fact would misrepresent how the transaction was actually
// captured, which several audit/analytics assumptions depend on.
export class UpdateTransactionDto extends PartialType(
  OmitType(CreateTransactionDto, ['idempotencyKey', 'sourceType'] as const),
) {}
